import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cacheKey } from '../src/cache.js';
import { readBottomImage, runTryOnRequest } from '../src/tryon-request.js';

const PRODUCT = 'https://cdn.shopify.com/s/files/1/set.jpg?width=1600';
const MODEL = 'https://cdn.shopify.com/s/files/1/model.jpg';
const BOTTOM = 'https://cdn.shopify.com/s/files/1/joggers.jpg?width=480';
const TOP_RESULT = 'https://cdn.fashn.ai/top-result.jpg';
const OUTFIT_RESULT = 'https://cdn.fashn.ai/outfit-result.jpg';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function memoryCache() {
  const store = new Map();
  return {
    store,
    readCached(key) {
      return store.get(key) || null;
    },
    writeCached(key, buffer) {
      store.set(key, { buffer, contentType: 'image/jpeg', key });
      return key;
    },
    cachePublicPath(key) {
      return `/apps/koko-tryon/cache/${key}`;
    },
  };
}

function harness(overrides = {}) {
  const cache = memoryCache();
  const fetched = [];
  const runs = [];
  const downloads = [];
  const deps = {
    requestTimeoutMs: 85_000,
    fetchRemoteImage: async (url) => {
      fetched.push(url);
      if (String(url).includes('fashn.ai')) throw new Error('image_host_forbidden');
      return url;
    },
    validateShopperImage: async (dataUrl) => dataUrl,
    cacheKey,
    readCached: cache.readCached,
    writeCached: cache.writeCached,
    cachePublicPath: cache.cachePublicPath,
    downloadResultImage: async (url) => {
      downloads.push(url);
      if (String(url).includes('download-fail')) throw new Error('result_fetch_failed');
      return { buffer: JPEG, contentType: 'image/jpeg' };
    },
    runTryOn: async (step) => {
      runs.push(step);
      if (step.category === 'bottoms' && overrides.failBottoms) {
        throw new Error(overrides.bottomsError || 'fashn_failed');
      }
      return {
        imageUrl: step.category === 'bottoms' ? OUTFIT_RESULT : TOP_RESULT,
        predictionId: step.category,
      };
    },
    ...overrides.deps,
  };
  return { cache, fetched, runs, downloads, deps };
}

test('readBottomImage treats blank as top-only and rejects non-strings', () => {
  assert.equal(readBottomImage(undefined), '');
  assert.equal(readBottomImage(null), '');
  assert.equal(readBottomImage(''), '');
  assert.equal(readBottomImage('  https://cdn.shopify.com/a.jpg  '), 'https://cdn.shopify.com/a.jpg');
  assert.throws(() => readBottomImage({ url: 'https://cdn.shopify.com/a.jpg' }), /invalid_image_url/);
});

test('lookupOnly cache keys differ for a set and do not call FASHN', async () => {
  const top = harness();
  const topMiss = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL, lookupOnly: true },
    ...top.deps,
  });
  assert.deepEqual(topMiss.body, { cached: false });
  assert.equal(top.runs.length, 0);
  assert.equal(top.fetched.length, 0);

  const outfit = harness();
  const outfitMiss = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL, bottomImage: BOTTOM, lookupOnly: true },
    ...outfit.deps,
  });
  assert.deepEqual(outfitMiss.body, { cached: false });
  assert.equal(outfit.runs.length, 0);
  assert.notEqual(cacheKey(PRODUCT, MODEL, BOTTOM), cacheKey(PRODUCT, MODEL));

  const outfitKey = cacheKey(PRODUCT, MODEL, BOTTOM);
  outfit.cache.store.set(outfitKey, { buffer: JPEG, contentType: 'image/jpeg', key: outfitKey });
  const hit = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL, bottomImage: BOTTOM, lookupOnly: true },
    ...outfit.deps,
  });
  assert.equal(hit.body.cached, true);
  assert.equal(hit.body.imageUrl, `/apps/koko-tryon/cache/${outfitKey}`);
  assert.equal(hit.body.imageDataUrl, `data:image/jpeg;base64,${JPEG.toString('base64')}`);
  assert.equal(outfit.runs.length, 0);

  const topHit = harness();
  const topKey = cacheKey(PRODUCT, MODEL);
  topHit.cache.store.set(topKey, { buffer: JPEG, contentType: 'image/jpeg', key: topKey });
  const ignored = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL, bottomImage: BOTTOM, lookupOnly: true },
    ...topHit.deps,
  });
  assert.equal(ignored.body.cached, false);
});

test('virtual outfit try-on chains bottoms onto the top result and caches the final image', async () => {
  const { deps, fetched, runs, downloads, cache } = harness();
  const outcome = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL, bottomImage: PRODUCT },
    ...deps,
  });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.cached, false);
  assert.equal(outcome.body.imageUrl, OUTFIT_RESULT);
  assert.match(outcome.body.imageDataUrl, /^data:image\/jpeg;base64,/);
  assert.deepEqual(runs.map((step) => step.category), ['tops', 'bottoms']);
  assert.equal(runs[0].modelImage, MODEL);
  assert.equal(runs[0].garmentImage, PRODUCT);
  assert.equal(runs[0].timeoutMs, 85_000);
  assert.equal(runs[1].modelImage, TOP_RESULT);
  assert.equal(runs[1].garmentImage, PRODUCT);
  assert.equal(runs[1].timeoutMs, 85_000);
  assert.deepEqual(fetched, [PRODUCT, PRODUCT, MODEL]);
  assert.equal(fetched.some((url) => url.includes('fashn.ai')), false);
  assert.deepEqual(downloads, [OUTFIT_RESULT]);
  assert.equal(cache.store.has(cacheKey(PRODUCT, MODEL)), false);
  assert.equal(cache.store.has(cacheKey(PRODUCT, MODEL, PRODUCT)), true);
});

test('bottoms failure returns the top image and does not store it as the outfit', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const { deps, runs, downloads, cache } = harness({ failBottoms: true, bottomsError: 'fashn_timeout' });
    const outcome = await runTryOnRequest({
      body: { productImage: PRODUCT, modelImage: MODEL, bottomImage: BOTTOM },
      ...deps,
    });
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.imageUrl, TOP_RESULT);
    assert.match(outcome.body.imageDataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(outcome.body.cached, false);
    assert.equal(runs.length, 2);
    assert.deepEqual(downloads, [TOP_RESULT]);
    assert.equal(cache.store.size, 0);
    const failed = lines.map((line) => JSON.parse(line)).find((entry) => entry.event === 'bottoms_failed');
    assert.deepEqual(failed, { event: 'bottoms_failed', code: 'fashn_timeout' });
    assert.equal(lines.some((line) => line.includes('fashn.ai') || line.includes('Bearer')), false);
  } finally {
    console.log = original;
  }
});

test('bottoms download failure still returns the top URL', async () => {
  const { deps } = harness({
    failBottoms: true,
    deps: {
      downloadResultImage: async () => {
        throw new Error('result_fetch_failed');
      },
    },
  });
  const outcome = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL, bottomImage: BOTTOM },
    ...deps,
  });
  assert.equal(outcome.body.imageUrl, TOP_RESULT);
  assert.equal('imageDataUrl' in outcome.body, false);
  assert.equal(outcome.body.cached, false);
});

test('lookupOnly rejects a non-https bottom before any try-on', async () => {
  const { deps, runs } = harness();
  await assert.rejects(
    () => runTryOnRequest({
      body: {
        productImage: PRODUCT,
        modelImage: MODEL,
        bottomImage: 'http://cdn.shopify.com/joggers.jpg',
        lookupOnly: true,
      },
      ...deps,
    }),
    /invalid_image_url/
  );
  assert.equal(runs.length, 0);
});

test('your photo bottoms failure still returns the top image', async () => {
  const { deps, cache } = harness({ failBottoms: true });
  const outcome = await runTryOnRequest({
    body: {
      productImage: PRODUCT,
      shopperImage: 'data:image/jpeg;base64,abc',
      bottomImage: BOTTOM,
    },
    ...deps,
  });
  assert.deepEqual(outcome.body, { imageUrl: TOP_RESULT });
  assert.equal(cache.store.size, 0);
});

test('your photo uses bottomImage and does not touch the virtual-model cache', async () => {
  const shopper = 'data:image/jpeg;base64,abc';
  const { deps, runs, fetched, cache } = harness();
  const outcome = await runTryOnRequest({
    body: { productImage: PRODUCT, shopperImage: shopper, bottomImage: BOTTOM },
    ...deps,
  });
  assert.deepEqual(outcome.body, { imageUrl: OUTFIT_RESULT });
  assert.equal(runs[0].modelImage, shopper);
  assert.equal(runs[1].modelImage, TOP_RESULT);
  assert.equal(runs[1].category, 'bottoms');
  assert.deepEqual(fetched, [PRODUCT, BOTTOM]);
  assert.equal(cache.store.size, 0);
});

test('top-only virtual generation stays a single tops call and returns imageDataUrl', async () => {
  const { deps, runs, cache } = harness();
  const outcome = await runTryOnRequest({
    body: { productImage: PRODUCT, modelImage: MODEL },
    ...deps,
  });
  assert.deepEqual(runs.map((step) => step.category), ['tops']);
  assert.equal(runs[0].timeoutMs, 85_000);
  assert.match(outcome.body.imageDataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(cache.store.has(cacheKey(PRODUCT, MODEL)), true);
});

test('the HTTP handler rate-limits once per POST', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.equal((server.match(/limiter\(/g) || []).length, 1);
});
