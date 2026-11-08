import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

test('cacheKey includes bottom image so outfits do not reuse top-only cache', () => {
  const model = 'https://cdn.shopify.com/s/files/1/model.jpg';
  const garment = 'https://cdn.shopify.com/s/files/1/garment.jpg';
  const bottom = 'https://cdn.shopify.com/s/files/1/pants.jpg';
  const topOnly = cacheKey(garment, model);
  assert.equal(topOnly, cacheKey(garment, model, ''));
  assert.equal(topOnly, cacheKey(garment, model, undefined));
  const outfit = cacheKey(garment, model, bottom);
  assert.notEqual(topOnly, outfit);
  assert.equal(outfit, cacheKey(garment, model, `${bottom}?width=1600`));
  assert.notEqual(outfit, cacheKey(garment, model, 'https://cdn.shopify.com/s/files/1/other-pants.jpg'));
});
