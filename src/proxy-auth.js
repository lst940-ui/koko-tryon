import crypto from 'node:crypto';

function flatten(value) {
  return Array.isArray(value) ? value.join(',') : String(value ?? '');
}

export function verifyAppProxySignature(url, sharedSecret) {
  if (!sharedSecret) return { ok: false, reason: 'missing_secret' };
  const params = new URL(url, 'https://example.invalid').searchParams;
  const signature = params.get('signature');
  if (!signature) return { ok: false, reason: 'missing_signature' };

  const entries = [];
  for (const [key, value] of params.entries()) {
    if (key === 'signature') continue;
    entries.push([key, value]);
  }
  const grouped = new Map();
  for (const [key, value] of entries) {
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  const sorted = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .join('');
  const digest = crypto.createHmac('sha256', sharedSecret).update(sorted).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const shop = String(params.get('shop') || '').toLowerCase();
  const timestamp = Number(params.get('timestamp') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!timestamp || Math.abs(now - timestamp) > 300) {
    return { ok: false, reason: 'stale_timestamp', shop };
  }
  return { ok: true, shop, pathPrefix: params.get('path_prefix') || '' };
}


export function verifyAppProxyRequest(req, sharedSecret) {
  const fromUrl = `${req?.protocol || 'https'}://${(typeof req?.get === 'function' && req.get('host')) || 'example.invalid'}${req?.originalUrl || req?.url || '/'}`;
  const urlResult = verifyAppProxySignature(fromUrl, sharedSecret);
  if (urlResult.reason !== 'missing_signature') return urlResult;

  const query = req?.query;
  if (!query || typeof query !== 'object') return urlResult;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
    else if (value !== undefined && value !== null) params.append(key, String(value));
  }
  return verifyAppProxySignature(`https://example.invalid/?${params.toString()}`, sharedSecret);
}

export function isAllowedShop(shop, allowedShops) {
  if (!shop) return false;
  const normalized = shop.toLowerCase();
  if (allowedShops.has(normalized)) return true;
  if (normalized.endsWith('.myshopify.com')) {
    const handle = normalized.replace(/\.myshopify\.com$/, '');
    return allowedShops.has(handle) || allowedShops.has(`${handle}.myshopify.com`);
  }
  return false;
}

export { flatten };
