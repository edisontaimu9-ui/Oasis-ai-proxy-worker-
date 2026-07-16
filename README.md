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

## Note on CORS / secrets
`Access-Control-Allow-Origin: '*'` means literally any website can call this
endpoint and read back these keys — including `VAPID_PRIVATE_KEY`, which
should never leave your server. Two possible improvements, either safe to do
independently of the CF migration:
- Set `ALLOWED_ORIGIN` in `worker.js` to your actual site's origin instead of `'*'`.
- Stop returning `VAPID_PRIVATE_KEY` (and, elsewhere in your app, any payment
  secret keys) from this endpoint entirely — those are only needed
  server-side to sign push notifications / verify payments, not in the browser.
