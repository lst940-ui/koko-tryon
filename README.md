# KOKO Try-On AI app proxy

Server-side Shopify app proxy for unpaid-theme try-on on **koko077.com / i13ur2-10**.

- Storefront path: `/apps/koko-tryon`
- Frontend contract: `/workspace/koko-ai-1108-backend-contract.md`
- Theme target once live: unpublished **KOKO Try-On AI 1108** (`147999195202`)
- Provider: FASHN `tryon-v1.6` (1 credit / successful image, so an outfit set is about 2). Key stays in `process.env.FASHN_API_KEY` only.

## What this app does

`POST /apps/koko-tryon` (also `/` and `/apps/koko-tryon/`, via Shopify app proxy) accepts a top:

```json
{ "productImage": "https://cdn.shopify.com/...", "modelImage": "https://cdn.shopify.com/..." }
```

or Your photo:

```json
{ "productImage": "https://cdn.shopify.com/...", "shopperImage": "data:image/jpeg;base64,..." }
```

Outfit sets (hoodie & joggers, tracksuit, two-piece) add `bottomImage`, an https Shopify CDN URL. Send the same URL as `productImage` when that color photo already shows both pieces:

```json
{
  "productImage": "https://cdn.shopify.com/.../set.jpg",
  "bottomImage": "https://cdn.shopify.com/.../set.jpg",
  "modelImage": "https://cdn.shopify.com/.../model.jpg"
}
```

Omit `bottomImage` for T-shirts, shirts, polos, and single hoodies. Your photo accepts `bottomImage` the same way. `lookupOnly: true` is virtual-model only; the cache key includes the bottom image when present, so a top-only entry is not reused for a set.

No `bottomImage` is one FASHN run with `category: "tops"`. A `bottomImage` runs tops with `productImage`, then bottoms with `bottomImage`, using the first result as the person image. Each step uses `REQUEST_TIMEOUT_MS` (default 85s), so a set can take about 170s. One storefront POST still counts as one rate-limit request. If bottoms fail after a successful top, the top image is returned and that partial result is not cached.

It verifies the Shopify proxy signature, restricts the shop to `i13ur2-10.myshopify.com` / `koko077.com`, rate-limits, validates images (SSRF-safe CDN hosts for product/model/bottom; decoded shopper photos), calls FASHN server-side, polls until complete, and returns:

```json
{ "imageUrl": "https://cdn.fashn.ai/...", "imageDataUrl": "data:image/jpeg;base64,...", "cached": false }
```

Virtual-model cache hits use the same `imageUrl` + `imageDataUrl` shape (`imageUrl` is the app cache path). Your photo returns `{ "imageUrl": "https://cdn.fashn.ai/..." }`. FASHN result hosts are not checked against the Shopify CDN allowlist. No API key is ever returned to the theme.

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
