/**
 * Oasis Config — Cloudflare Worker version
 * Equivalent of your Appwrite Function (index.js), adapted to the
 * Workers fetch handler signature.
 *
 * Secrets are read from env (Worker bindings), not process.env.
 * Set them with:  wrangler secret put GROQ_API_KEY   (etc.)
 */

const ALLOWED_ORIGIN = '*'; // ⚠️ consider restricting to your real domain, e.g. 'https://yourapp.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: corsHeaders });
    }

    const groqKey = env.GROQ_API_KEY || '';
    const openRouterKey = env.OPENROUTER_API_KEY || '';

    console.log(
      'Config keys requested — GROQ key length: ' + groqKey.length +
      ', OPENROUTER key length: ' + openRouterKey.length
    );

    const body = {
      GROQ_API_KEY:              groqKey,
      OPENROUTER_API_KEY:        openRouterKey,
      PUBMED_API_KEY:            env.PUBMED_API_KEY              || '',
      FRONTIERS_API_KEY:         env.FRONTIERS_API_KEY           || '',
      ELSEVIER_API_KEY:          env.ELSEVIER_API_KEY            || '',
      VAPID_PUBLIC_KEY:          env.VAPID_PUBLIC_KEY            || '',
      VAPID_PRIVATE_KEY:         env.VAPID_PRIVATE_KEY           || '',
      FATSECRET_CONSUMER_KEY:    env.FATSECRET_CONSUMER_KEY      || '',
      FATSECRET_CONSUMER_SECRET: env.FATSECRET_CONSUMER_SECRET   || '',
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  },
};
