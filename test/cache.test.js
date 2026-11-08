import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  cacheKey,
  cachePublicPath,
  isValidCacheKey,
  normalizeImageUrl,
  readCached,
  writeCached,
  CACHE_DIR,
} from '../src/cache.js';

test('normalizeImageUrl drops width/query noise', () => {
  assert.equal(
    normalizeImageUrl('https://CDN.SHOPIFY.COM/s/files/1/x.jpg?width=1600&v=1'),
    'https://cdn.shopify.com/s/files/1/x.jpg'
  );
  assert.equal(
    normalizeImageUrl('https://cdn.shopify.com/s/files/1/x.jpg?width=480'),
    'https://cdn.shopify.com/s/files/1/x.jpg'
  );
  assert.throws(() => normalizeImageUrl('http://cdn.shopify.com/x.jpg'));
});

test('cacheKey is stable across width params and sensitive to path', () => {
  const model = 'https://cdn.shopify.com/s/files/1/0711/6809/8370/files/goldencross-gallery-01.jpg';
  const a = cacheKey('https://cdn.shopify.com/s/files/1/garment.jpg?width=1600', model);
  const b = cacheKey('https://cdn.shopify.com/s/files/1/garment.jpg?width=480', `${model}?width=1600`);
  const c = cacheKey('https://cdn.shopify.com/s/files/1/other.jpg?width=1600', model);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(isValidCacheKey(a), true);
  assert.equal(cachePublicPath(a), `/apps/koko-tryon/cache/${a}`);
});

test('cacheKey keeps the top-only digest and changes when a bottom image is set', () => {
  const product = 'https://cdn.shopify.com/s/files/1/garment.jpg?width=1600';
  const model = 'https://cdn.shopify.com/s/files/1/model.jpg';
  const legacy = crypto.createHash('sha256').update(
    'https://cdn.shopify.com/s/files/1/garment.jpg\nhttps://cdn.shopify.com/s/files/1/model.jpg'
  ).digest('hex');
  const topOnly = cacheKey(product, model);
  assert.equal(topOnly, legacy);
  assert.equal(cacheKey(product, model, ''), legacy);
  assert.equal(cacheKey(product, model, '   '), legacy);
  assert.equal(cacheKey(product, model, null), legacy);

  const joggers = 'https://cdn.shopify.com/s/files/1/joggers.jpg?width=480';
  const withBottom = cacheKey(product, model, joggers);
  assert.notEqual(withBottom, topOnly);
  assert.equal(
    withBottom,
    cacheKey(product, model, 'https://cdn.shopify.com/s/files/1/joggers.jpg?width=1600')
  );
  assert.notEqual(
    withBottom,
    cacheKey(product, model, 'https://cdn.shopify.com/s/files/1/other-joggers.jpg')
  );
  // Same color photo for both pieces is still an outfit, not the old top-only entry.
  assert.notEqual(cacheKey(product, model, product), topOnly);
  assert.throws(() => cacheKey(product, model, 'http://cdn.shopify.com/joggers.jpg'));
});

test('read/write hit and miss without FASHN', () => {
  const key = cacheKey(
    'https://cdn.shopify.com/s/files/1/test-garment.jpg',
    'https://cdn.shopify.com/s/files/1/0711/6809/8370/files/goldencross-gallery-01.jpg'
  );
  const file = path.join(CACHE_DIR, `${key}.jpg`);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* ignore */ }

  assert.equal(readCached(key), null);
  const payload = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03]);
  writeCached(key, payload);
  const hit = readCached(key);
  assert.ok(hit);
  assert.equal(hit.key, key);
  assert.deepEqual(hit.buffer, payload);
  assert.equal(hit.contentType, 'image/jpeg');

  fs.unlinkSync(file);
  assert.equal(readCached(key), null);
});
