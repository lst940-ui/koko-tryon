import express from 'express';
import { loadConfig } from './config.js';
import { verifyAppProxySignature, isAllowedShop } from './proxy-auth.js';
import { createRateLimiter } from './rate-limit.js';
import { fetchAndValidateRemoteImage, validateDataUrlImage } from './images.js';
import { runTryOn } from './fashn.js';

const config = loadConfig();
const app = express();
const limiter = createRateLimiter({ limit: config.maxRequestsPerMinute });

app.disable('x-powered-by');
app.use(express.json({
  limit: config.maxBodyBytes,
  type: ['application/json', 'application/*+json'],
}));

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function jsonError(res, status, code) {
  return res.status(status).json({ error: code });
}

async function handleTryOn(req, res) {
  try {
    if (!config.shopifyApiSecret) return jsonError(res, 503, 'proxy_not_configured');
    if (!config.fashnApiKey) return jsonError(res, 503, 'fashn_not_configured');

    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const auth = verifyAppProxySignature(fullUrl, config.shopifyApiSecret);
    if (!auth.ok) return jsonError(res, 401, 'invalid_proxy_signature');
    if (!isAllowedShop(auth.shop, config.allowedShops)) return jsonError(res, 403, 'shop_not_allowed');

    const rate = limiter(clientKey(req));
    if (!rate.ok) {
      res.set('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
      return jsonError(res, 429, 'rate_limited');
    }

    const body = req.body || {};
    const productImage = body.productImage;
    const modelImage = body.modelImage;
    const shopperImage = body.shopperImage;
    if (!productImage || typeof productImage !== 'string') return jsonError(res, 400, 'product_image_required');
    if (!modelImage && !shopperImage) return jsonError(res, 400, 'model_or_shopper_required');
    if (modelImage && shopperImage) return jsonError(res, 400, 'choose_one_person_image');

    const garment = await fetchAndValidateRemoteImage(productImage, config.allowedCdnHosts);
    let person;
    if (shopperImage) {
      person = await validateDataUrlImage(shopperImage);
    } else {
      person = await fetchAndValidateRemoteImage(modelImage, config.allowedCdnHosts);
    }

    const result = await runTryOn({
      apiKey: config.fashnApiKey,
      modelImage: person,
      garmentImage: garment,
      modelName: config.fashnModel,
      mode: config.fashnMode,
      timeoutMs: config.requestTimeoutMs,
    });

    return res.status(200).json({ imageUrl: result.imageUrl });
  } catch (error) {
    const code = error?.message || 'tryon_failed';
    const status = error?.status === 401 || error?.status === 403 ? 502
      : code.includes('rate') ? 429
      : code.includes('forbidden') || code.includes('invalid') || code.includes('required') || code.includes('too_large') || code.includes('undecodable') ? 400
      : code.includes('timeout') ? 504
      : 502;
    // Never include provider payloads, API keys, or shopper image data.
    return jsonError(res, status, code);
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    fashnConfigured: Boolean(config.fashnApiKey),
    proxySecretConfigured: Boolean(config.shopifyApiSecret),
  });
});

// Shopify app proxy forwards /apps/koko-tryon* to this path (relative or absolute).
app.post(['/apps/koko-tryon', '/apps/koko-tryon/', '/'], handleTryOn);
app.all(['/apps/koko-tryon', '/apps/koko-tryon/'], (_req, res) => jsonError(res, 405, 'method_not_allowed'));

app.use((_req, res) => jsonError(res, 404, 'not_found'));

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    // Do not log secrets or request bodies.
    console.log(`koko-tryon listening on ${config.port}`);
  });
}

export { app, handleTryOn };
