/**
 * Oasis Config / API Proxy — Cloudflare Worker
 *
 * All secrets stay server-side. The browser only ever talks to these
 * routes on this Worker — it never sees a real API key.
 *
 *   GET  /config              -> only values safe to expose (VAPID_PUBLIC_KEY).
 *   POST /groq                -> chat completion via Groq.
 *   POST /openrouter          -> chat completion via OpenRouter (same shape as Groq).
 *   GET  /pubmed?endpoint=...  -> pass-through to NCBI E-utilities (esearch/esummary/efetch).
 *   GET  /frontiers            -> pass-through to Frontiers Search API.
 *   GET  /elsevier?endpoint=... -> pass-through to Elsevier (scopus/sciencedirect/abstract).
 *
 * The pubmed/frontiers/elsevier routes are deliberate pass-throughs: the
 * client sends the same query params it always did (minus any key), the
 * Worker adds the real key server-side, forwards to the real API, and
 * returns the response body/status untouched. This means the existing
 * response-parsing code in library.js keeps working without changes —
 * only the request URLs needed to change.
 *
 * Set secrets with:  wrangler secret put GROQ_API_KEY   (etc.)
 */

const ALLOWED_ORIGIN = 'https://oasiscnst.app';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// Wraps an upstream fetch Response, preserving its body/content-type/status
// but adding our CORS headers.
async function passThrough(upstreamRes) {
  const text = await upstreamRes.text();
  const contentType = upstreamRes.headers.get('Content-Type') || 'application/json';
  return new Response(text, {
    status: upstreamRes.status,
    headers: { 'Content-Type': contentType, ...corsHeaders },
  });
}

async function handleConfig(env) {
  // Only ever return values that are meant to be public.
  // VAPID_PUBLIC_KEY is safe — it's designed to be shared with the browser
  // for push subscriptions. Nothing else belongs here.
  return json({
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY || '',
  });
}

// ── Chat-completion style proxies (Groq, OpenRouter) ──────────────────
async function proxyChatCompletion({ request, env, apiKeyName, apiUrl, defaultModel }) {
  const apiKey = env[apiKeyName];
  if (!apiKey) {
    return json({ error: { message: `${apiKeyName} is not configured on the server.` } }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: { message: 'Invalid JSON body.' } }, 400);
  }

  const { model, max_tokens, temperature, messages } = payload || {};
  if (!Array.isArray(messages)) {
    return json({ error: { message: '"messages" array is required.' } }, 400);
  }

  const upstreamRes = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || defaultModel,
      max_tokens: max_tokens || 900,
      temperature: temperature ?? 0.3,
      messages,
    }),
  });

  const data = await upstreamRes.json().catch(() => ({}));
  return json(data, upstreamRes.status);
}

function handleGroqProxy(request, env) {
  return proxyChatCompletion({
    request, env,
    apiKeyName: 'GROQ_API_KEY',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
  });
}

function handleOpenRouterProxy(request, env) {
  return proxyChatCompletion({
    request, env,
    apiKeyName: 'OPENROUTER_API_KEY',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openrouter/auto',
  });
}

// ── PubMed (NCBI E-utilities) pass-through ─────────────────────────────
// Client calls: /pubmed?endpoint=esearch&db=pubmed&term=...   (etc)
// Worker forwards to https://eutils.ncbi.nlm.nih.gov/entrez/eutils/<endpoint>.fcgi
// with the same params, plus api_key injected server-side.
async function handlePubmedProxy(request, env) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint');
  if (!['esearch', 'esummary', 'efetch'].includes(endpoint)) {
    return json({ error: { message: 'endpoint must be esearch, esummary, or efetch' } }, 400);
  }

  const upstream = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${endpoint}.fcgi`);
  url.searchParams.forEach((value, key) => {
    if (key !== 'endpoint') upstream.searchParams.set(key, value);
  });
  if (env.PUBMED_API_KEY) upstream.searchParams.set('api_key', env.PUBMED_API_KEY);

  const upstreamRes = await fetch(upstream.toString());
  return passThrough(upstreamRes);
}

// ── Frontiers Search API pass-through ─────────────────────────────────
// Client calls: POST /frontiers  { query, limit, offset }
// Frontiers' Search API requires POST with a JSON body (confirmed via
// their own "does not support http method GET" error) rather than GET
// with query params.
async function handleFrontiersProxy(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    payload = {};
  }
  const { query, limit, offset } = payload || {};
  if (!query) return json({ error: { message: '"query" is required.' } }, 400);

  const upstreamRes = await fetch('https://search-api.frontiersin.org/api/V1/search', {
    method: 'POST',
    headers: {
      'X-ELS-APIKey': env.FRONTIERS_API_KEY || '',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query: query,
      limit: limit || 10,
      offset: offset || 0,
    }),
  });
  return passThrough(upstreamRes);
}

// ── Elsevier (Scopus / ScienceDirect / Abstract Retrieval) pass-through ─
// Client calls:
//   /elsevier?endpoint=scopus&query=...&count=...&start=...&field=...
//   /elsevier?endpoint=sciencedirect&query=...&count=...&start=...&field=...
//   /elsevier?endpoint=abstract&scopusId=...
async function handleElsevierProxy(request, env) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint');

  let upstream;
  if (endpoint === 'scopus') {
    upstream = new URL('https://api.elsevier.com/content/search/scopus');
    url.searchParams.forEach((value, key) => { if (key !== 'endpoint') upstream.searchParams.set(key, value); });
  } else if (endpoint === 'sciencedirect') {
    upstream = new URL('https://api.elsevier.com/content/search/sciencedirect');
    url.searchParams.forEach((value, key) => { if (key !== 'endpoint') upstream.searchParams.set(key, value); });
  } else if (endpoint === 'abstract') {
    const scopusId = url.searchParams.get('scopusId') || '';
    upstream = new URL('https://api.elsevier.com/content/abstract/scopus_id/' + encodeURIComponent(scopusId));
  } else {
    return json({ error: { message: 'endpoint must be scopus, sciencedirect, or abstract' } }, 400);
  }
  upstream.searchParams.set('httpAccept', 'application/json');

  const upstreamRes = await fetch(upstream.toString(), {
    headers: {
      'X-ELS-APIKey': env.ELSEVIER_API_KEY || '',
      'Accept': 'application/json',
    },
  });
  return passThrough(upstreamRes);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/groq' && request.method === 'POST') {
      return handleGroqProxy(request, env);
    }
    if (url.pathname === '/openrouter' && request.method === 'POST') {
      return handleOpenRouterProxy(request, env);
    }
    if (url.pathname === '/pubmed' && request.method === 'GET') {
      return handlePubmedProxy(request, env);
    }
    if (url.pathname === '/frontiers' && request.method === 'POST') {
      return handleFrontiersProxy(request, env);
    }
    if (url.pathname === '/elsevier' && request.method === 'GET') {
      return handleElsevierProxy(request, env);
    }
    if (url.pathname === '/config' || url.pathname === '/') {
      return handleConfig(env);
    }

    return json({ error: { message: 'Not found' } }, 404);
  },
};
