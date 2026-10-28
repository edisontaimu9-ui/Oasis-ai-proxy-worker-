# Deploying oasis-config to Cloudflare Workers

## 1. Install wrangler (if you haven't)
```bash
npm install -g wrangler
wrangler login
```

## 2. Set your secrets (one time, or whenever they change)
```bash
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
wrangler secret put PUBMED_API_KEY
wrangler secret put FRONTIERS_API_KEY
wrangler secret put ELSEVIER_API_KEY
wrangler secret put CNR_API_KEY
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put FATSECRET_CONSUMER_KEY
wrangler secret put FATSECRET_CONSUMER_SECRET
```
Each command will prompt you to paste the secret value.

## 3. Deploy
```bash
wrangler deploy
```
This gives you a URL like:
`https://oasis-config.<your-subdomain>.workers.dev`

## 4. Update your frontend
In `index.html`, change the fetch URL from the old Appwrite endpoint:
```js
fetch('https://6a27bdd9002e2f1a60ae.sgp.appwrite.run', ...)
```
to your new Worker URL:
```js
fetch('https://oasis-config.<your-subdomain>.workers.dev', ...)
```

Also update your Content-Security-Policy `connect-src` line in `index.html`
(around line 101) to include `https://*.workers.dev` (or your exact Worker
URL) instead of/alongside `https://*.appwrite.run`.

## Security notes
- CORS is locked to `https://oasiscnst.app` (`ALLOWED_ORIGIN` in `worker.js`).
  This only restricts other websites in a browser; it does not stop curl or scripts.
- `/config` returns only `VAPID_PUBLIC_KEY`. No private key or secret is ever returned.
- `/groq` and `/openrouter` enforce a server-side model allowlist, a `max_tokens`
  ceiling (2000), and message count/size limits, whatever the caller sends.
- All routes are rate limited per IP via the `RATE_LIMITER` binding in
  `wrangler.toml` (60 requests / 60 s). Adjust `limit` there if real users hit it.
- `/cnr/*` forwards an allowlist of CNR routes and adds `CNR_API_KEY` server-side
  (set it as a Worker secret; it is never in the repo). GET: foods (search,
  lookup, autocomplete, substitutes, compare, convert, paging), formulas,
  exchange, renal, packaged, DRI, measures, memory recall. POST: `/rag/retrieve`,
  `/rag/ask`, `/memory/write`, `/memory/recall`, `/packaged/submit`,
  `/packaged/scan`, each with a body size limit. Admin and registry-write routes
  are not reachable, and any `Authorization` header from the browser is ignored.
  Calls go through the `CHAKUDYA_API` service binding in `wrangler.toml`.
