import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.resolve(__dirname, '../data/cache');
const KEY_RE = /^[a-f0-9]{64}$/;

/** Drop width/resize query noise so the same garment/model maps to one key. */
export function normalizeImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new Error('invalid_image_url');
  }
  if (url.protocol !== 'https:') throw new Error('image_url_must_be_https');
  return `${url.protocol}//${url.host.toLowerCase()}${url.pathname}`;
}

export function cacheKey(productImageUrl, modelImageUrl) {
  const garment = normalizeImageUrl(productImageUrl);
  const model = normalizeImageUrl(modelImageUrl);
  return crypto.createHash('sha256').update(`${garment}\n${model}`).digest('hex');
}

export function isValidCacheKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function filePathFor(key) {
  if (!isValidCacheKey(key)) throw new Error('invalid_cache_key');
  return path.join(CACHE_DIR, `${key}.jpg`);
}

export function readCached(key) {
  if (!isValidCacheKey(key)) return null;
  const file = filePathFor(key);
  try {
    if (!fs.existsSync(file)) return null;
    const buffer = fs.readFileSync(file);
    if (!buffer.length) return null;
    return { buffer, contentType: 'image/jpeg', key };
  } catch {
    return null;
  }
}

export function writeCached(key, buffer) {
  ensureCacheDir();
  const file = filePathFor(key);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);
  return file;
}

export function cachePublicPath(key) {
  if (!isValidCacheKey(key)) throw new Error('invalid_cache_key');
  return `/apps/koko-tryon/cache/${key}`;
}

/**
 * Download a generated result image (FASHN CDN may expire).
 * Not limited to Shopify CDN hosts; still blocks obvious SSRF targets.
 */
export async function downloadResultImage(rawUrl, timeoutMs = 20_000) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('invalid_result_url');
  }
  if (url.protocol !== 'https:') throw new Error('invalid_result_url');
  if (url.username || url.password) throw new Error('invalid_result_url');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.local')
    || host === 'metadata.google.internal'
    || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.64\.)/.test(host)
    || host === '[::1]'
  ) {
    throw new Error('invalid_result_url');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'image/*,*/*;q=0.8' },
    });
    if (!response.ok) throw new Error('result_fetch_failed');
    const type = String(response.headers.get('content-type') || '');
    if (!/^image\/(jpeg|jpg|png|webp)/i.test(type)) throw new Error('result_type_forbidden');
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > 8_000_000) throw new Error('result_too_large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 8_000_000) throw new Error('result_too_large');
    return { buffer, contentType: /^image\/png/i.test(type) ? 'image/png' : /^image\/webp/i.test(type) ? 'image/webp' : 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}
