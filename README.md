# KOKO Try-On AI app proxy

Server-side Shopify app proxy for unpaid-theme try-on on **koko077.com / i13ur2-10**.

- Storefront path: `/apps/koko-tryon`
- Frontend contract: `/workspace/koko-ai-1108-backend-contract.md`
- Theme target once live: unpublished **KOKO Try-On AI 1108** (`147999195202`)
- Provider: FASHN `tryon-v1.6` (1 credit / image). Key stays in `process.env.FASHN_API_KEY` only.

## What this app does

`POST /apps/koko-tryon` (via Shopify app proxy) accepts:

```json
{ "productImage": "https://cdn.shopify.com/...", "modelImage": "https://cdn.shopify.com/..." }
```

or

```json
{ "productImage": "https://cdn.shopify.com/...", "shopperImage": "data:image/jpeg;base64,..." }
```

It verifies the Shopify proxy signature, restricts the shop to `i13ur2-10.myshopify.com` / `koko077.com`, rate-limits, validates images (SSRF-safe CDN hosts for product/model; decoded shopper photos), calls FASHN server-side, polls until complete, and returns:

```json
{ "imageUrl": "https://cdn.fashn.ai/..." }
```

No API key is ever returned to the theme.

## Blocked without human Partner/Dev Dashboard steps

This box has:

- `FASHN_API_KEY` available to processes
- complete app source under this folder

It does **not** have:

- Shopify Partner / Dev Dashboard credentials
- a public HTTPS host for the proxy
- an installed app on `i13ur2-10`

Until those exist, `/apps/koko-tryon` is not live on the storefront, and the theme proxy URL setting must stay blank.

## Exact remaining human steps

1. On your own computer, open [Shopify Dev Dashboard](https://dev.shopify.com/dashboard) (Partner/organization that owns koko077.com).
2. Create app → name it **KOKO Try-On AI**.
3. Host this folder on any HTTPS server (Fly, Render, Cloud Run, Railway, VPS). Set env from `.env.example`:
   - `FASHN_API_KEY` (server only)
   - `SHOPIFY_API_SECRET` = app Client secret from Dev Dashboard Settings
   - `ALLOWED_SHOPS=i13ur2-10.myshopify.com,koko077.com`
4. In `shopify.app.toml`, set `client_id`, `application_url` to your public HTTPS origin, keep:
   ```toml
   [app_proxy]
   url = "/apps/koko-tryon"
   prefix = "apps"
   subpath = "koko-tryon"
   ```
   scopes: `write_app_proxy`.
5. Release a version (Dev Dashboard Versions, or `shopify app deploy` after `npm i -g @shopify/cli`).
6. Install the app on store **i13ur2-10 / koko077.com**.
7. Confirm `https://koko077.com/apps/koko-tryon` reaches this server (Shopify adds signature query params).
8. Tell Grok Bot the proxy is live. Then on unpublished theme **147999195202** only, set Product information → **AI try-on app proxy URL** to `/apps/koko-tryon` (or the full same-origin HTTPS path). Do **not** publish until you verify Virtual model + Your photo.
9. Optional local checks before install:
   ```bash
   cd /workspace/koko-tryon-app
   npm install
   npm test
   npm run check:auth   # dry auth only; does not generate images / spend try-on credits
   ```

## Local commands

```bash
npm install
npm test
npm run check:auth
PORT=8787 SHOPIFY_API_SECRET=... FASHN_API_KEY=... npm start
```

Do not run generating try-ons for routine testing. Use one cheap successful generation only when validating end-to-end after install.
