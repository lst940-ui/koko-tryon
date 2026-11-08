import sharp from 'sharp';

const MAX_PIXELS = 12_000_000;
const MAX_BYTES = 8_000_000;

function hostAllowed(hostname, allowedCdnHosts) {
  const host = hostname.toLowerCase();
  return allowedCdnHosts.some((rule) => {
    if (typeof rule === 'string') return host === rule.toLowerCase();
    return rule.test(host);
  });
}

export function assertSafePublicImageUrl(raw, allowedCdnHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid_image_url');
  }
  if (url.protocol !== 'https:') throw new Error('image_url_must_be_https');
  if (url.username || url.password) throw new Error('image_url_credentials_forbidden');
  if (url.port && url.port !== '443') throw new Error('image_url_port_forbidden');
  if (!hostAllowed(url.hostname, allowedCdnHosts)) throw new Error('image_host_forbidden');
  return url.toString();
}

export async function validateDataUrlImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('invalid_shopper_image');
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error('invalid_shopper_image');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('shopper_image_too_large');
  const image = sharp(buffer, { failOn: 'error' });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('shopper_image_undecodable');
  if (meta.width * meta.height > MAX_PIXELS) throw new Error('shopper_image_too_large');
  const cleaned = await image.rotate().toFormat(meta.format === 'jpeg' ? 'jpeg' : meta.format === 'webp' ? 'webp' : 'png').toBuffer();
  const mime = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${cleaned.toString('base64')}`;
}

export async function fetchAndValidateRemoteImage(url, allowedCdnHosts) {
  const safe = assertSafePublicImageUrl(url, allowedCdnHosts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(safe, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'image/*,*/*;q=0.8' },
    });
    if (!response.ok) throw new Error('image_fetch_failed');
    const type = String(response.headers.get('content-type') || '');
    if (!/^image\/(jpeg|png|webp)/i.test(type)) throw new Error('image_type_forbidden');
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > MAX_BYTES) throw new Error('image_too_large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('image_too_large');
    const meta = await sharp(buffer, { failOn: 'error' }).metadata();
    if (!meta.width || !meta.height) throw new Error('image_undecodable');
    if (meta.width * meta.height > MAX_PIXELS) throw new Error('image_too_large');
    return safe;
  } finally {
    clearTimeout(timer);
  }
}
