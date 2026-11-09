/**
 * Non-blocking try-on usage logs for Render.
 * Never awaits, never fetches, never throws into the request path.
 * No customer PII (no IP, photo/data-URL, email).
 */

function safeString(value, max = 200) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Pull a stable garment identifier from a Shopify CDN product image URL.
 * Example: .../cdn/shop/files/XWY018-AZTEC01-01front.jpg?v=...&width=480
 * -> file "XWY018-AZTEC01-01front.jpg", path "/cdn/shop/files/XWY018-AZTEC01-01front.jpg"
 */
export function productRefFromImageUrl(productImage) {
  const out = {};
  if (typeof productImage !== 'string' || !productImage) return out;
  try {
    // Support protocol-relative URLs from the theme.
    const raw = productImage.startsWith('//') ? `https:${productImage}` : productImage;
    const url = new URL(raw);
    const path = url.pathname || '';
    if (path) out.productImagePath = path.slice(0, 300);
    const file = path.split('/').filter(Boolean).pop();
    if (file) out.productImageFile = file.slice(0, 200);
  } catch {
    // Ignore malformed URLs; still log other fields.
  }
  return out;
}

/**
 * Optional future body fields (theme may send later). Never required.
 */
export function optionalProductFields(body = {}) {
  const out = {};
  const productId = safeString(body.productId ?? body.product_id, 64);
  const handle = safeString(body.handle ?? body.productHandle, 128);
  const title = safeString(body.title ?? body.productTitle, 200);
  const color = safeString(body.color ?? body.colour, 64);
  const variantId = safeString(
    body.variantId != null ? String(body.variantId) : body.variant_id != null ? String(body.variant_id) : undefined,
    64,
  );
  if (productId) out.productId = productId;
  if (handle) out.handle = handle;
  if (title) out.title = title;
  if (color) out.color = color;
  if (variantId) out.variantId = variantId;
  return out;
}

export function buildTryOnUsageLog({
  result,
  lookupOnly,
  productImage,
  bottomImage,
  shopperImage,
  body,
  code,
  event = 'tryon_cache',
}) {
  const payload = {
    event,
    result,
    ts: new Date().toISOString(),
  };
  if (lookupOnly != null) payload.lookupOnly = Boolean(lookupOnly);
  payload.outfit = Boolean(bottomImage);
  payload.person = shopperImage ? 'shopper' : 'model';
  Object.assign(payload, productRefFromImageUrl(productImage));
  Object.assign(payload, optionalProductFields(body));
  if (code) payload.code = safeString(String(code), 120);
  return payload;
}

/** Fire-and-forget JSON log. Safe to call on every request path. */
export function logTryOnUsage(fields) {
  try {
    const line = JSON.stringify(fields);
    setImmediate(() => {
      try {
        console.log(line);
      } catch {
        // swallow
      }
    });
  } catch {
    // swallow
  }
}
