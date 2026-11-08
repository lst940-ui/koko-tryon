import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunBody,
  executeTryOnPlan,
  planTryOn,
  publicErrorCode,
  runTryOn,
  stepTimeoutMs,
  tryOnBudgetMs,
} from '../src/fashn.js';

const PRODUCT = 'https://cdn.shopify.com/s/files/1/set.jpg';
const PERSON = 'https://cdn.shopify.com/s/files/1/model.jpg';
const BOTTOM = 'https://cdn.shopify.com/s/files/1/joggers.jpg';
const TOP_RESULT = 'https://cdn.fashn.ai/top-result.jpg';
const OUTFIT_RESULT = 'https://cdn.fashn.ai/outfit-result.jpg';

test('buildRunBody defaults to tops and can request bottoms', () => {
  const tops = buildRunBody({
    modelName: 'tryon-v1.6',
    modelImage: PERSON,
    garmentImage: PRODUCT,
    mode: 'performance',
  });
  assert.equal(tops.model_name, 'tryon-v1.6');
  assert.equal(tops.inputs.category, 'tops');
  assert.equal(tops.inputs.garment_image, PRODUCT);
  assert.equal(tops.inputs.num_samples, 1);
  assert.equal('product_image' in tops.inputs, false);

  const bottoms = buildRunBody({
    modelName: 'tryon-v1.6',
    modelImage: TOP_RESULT,
    garmentImage: BOTTOM,
    category: 'bottoms',
    mode: 'performance',
  });
  assert.equal(bottoms.inputs.category, 'bottoms');
  assert.equal(bottoms.inputs.model_image, TOP_RESULT);
  assert.throws(() => buildRunBody({
    modelName: 'tryon-v1.6',
    modelImage: PERSON,
    garmentImage: PRODUCT,
    category: 'full-outfit',
    mode: 'performance',
  }));
});

test('planTryOn is one tops step unless bottomImage is present', () => {
  const top = planTryOn({});
  assert.equal(top.outfit, false);
  assert.deepEqual(top.steps, [{ category: 'tops', garmentSource: 'product' }]);
  assert.equal(planTryOn({ bottomImage: '  ' }).outfit, false);

  const outfit = planTryOn({ bottomImage: BOTTOM });
  assert.equal(outfit.outfit, true);
  assert.deepEqual(outfit.steps, [
    { category: 'tops', garmentSource: 'product' },
    { category: 'bottoms', garmentSource: 'bottom' },
  ]);
  assert.equal(planTryOn({ bottomImage: PRODUCT }).outfit, true);
});

test('outfit budget is two step timeouts, about 170s at the default', () => {
  const top = planTryOn({});
  const outfit = planTryOn({ bottomImage: BOTTOM });
  assert.equal(tryOnBudgetMs(85_000, top), 85_000);
  assert.equal(stepTimeoutMs(85_000, top), 85_000);
  assert.equal(tryOnBudgetMs(85_000, outfit), 170_000);
  assert.equal(stepTimeoutMs(85_000, outfit), 85_000);
  assert.equal(tryOnBudgetMs(Number.NaN, outfit), 170_000);
});

test('executeTryOnPlan applies tops then bottoms and feeds the first image forward', async () => {
  const plan = planTryOn({ bottomImage: PRODUCT });
  const calls = [];
  const outcome = await executeTryOnPlan({
    plan,
    personImage: PERSON,
    productImage: PRODUCT,
    bottomImage: PRODUCT,
    timeoutMs: stepTimeoutMs(85_000, plan),
    run: async (step) => {
      calls.push(step);
      return {
        imageUrl: step.category === 'tops' ? TOP_RESULT : OUTFIT_RESULT,
        predictionId: step.category,
      };
    },
  });

  assert.equal(outcome.bottomsFailed, false);
  assert.equal(outcome.result.imageUrl, OUTFIT_RESULT);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].category, 'tops');
  assert.equal(calls[0].modelImage, PERSON);
  assert.equal(calls[0].garmentImage, PRODUCT);
  assert.equal(calls[0].timeoutMs, 85_000);
  assert.equal(calls[1].category, 'bottoms');
  assert.equal(calls[1].modelImage, TOP_RESULT);
  assert.equal(calls[1].garmentImage, PRODUCT);
  assert.equal(calls[1].timeoutMs, 85_000);
});

test('a top-only plan does not run bottoms', async () => {
  const calls = [];
  const outcome = await executeTryOnPlan({
    plan: planTryOn({}),
    personImage: PERSON,
    productImage: PRODUCT,
    bottomImage: '',
    timeoutMs: 85_000,
    run: async (step) => {
      calls.push(step.category);
      return { imageUrl: TOP_RESULT };
    },
  });
  assert.deepEqual(calls, ['tops']);
  assert.equal(outcome.result.imageUrl, TOP_RESULT);
  assert.equal(outcome.bottomsFailed, false);
});

test('bottoms failure keeps the top result and hides unsafe error text', async () => {
  const outcome = await executeTryOnPlan({
    plan: planTryOn({ bottomImage: BOTTOM }),
    personImage: PERSON,
    productImage: PRODUCT,
    bottomImage: BOTTOM,
    timeoutMs: 85_000,
    run: async (step) => {
      if (step.category === 'bottoms') {
        throw new Error('https://cdn.fashn.ai/secret-output?token=abc');
      }
      return { imageUrl: TOP_RESULT };
    },
  });
  assert.equal(outcome.bottomsFailed, true);
  assert.equal(outcome.result.imageUrl, TOP_RESULT);
  assert.equal(outcome.code, 'bottoms_failed');
  assert.equal(publicErrorCode(new Error('fashn_timeout')), 'fashn_timeout');
});

test('tops failure is not reported as a bottoms fallback', async () => {
  await assert.rejects(
    () => executeTryOnPlan({
      plan: planTryOn({ bottomImage: BOTTOM }),
      personImage: PERSON,
      productImage: PRODUCT,
      bottomImage: BOTTOM,
      timeoutMs: 85_000,
      run: async () => {
        throw new Error('fashn_failed');
      },
    }),
    /fashn_failed/
  );
});

test('runTryOn posts the requested category without calling the network', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/run')) {
      return { ok: true, status: 200, json: async () => ({ id: 'pred_unit' }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'completed', output: [OUTFIT_RESULT] }),
    };
  };
  try {
    const result = await runTryOn({
      apiKey: 'unit-test-key',
      modelImage: TOP_RESULT,
      garmentImage: BOTTOM,
      category: 'bottoms',
      modelName: 'tryon-v1.6',
      mode: 'performance',
      timeoutMs: 5_000,
      pollIntervalMs: 0,
    });
    assert.equal(result.imageUrl, OUTFIT_RESULT);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.fashn.ai/v1/run');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.inputs.category, 'bottoms');
    assert.equal(body.inputs.model_image, TOP_RESULT);
    assert.equal(body.inputs.garment_image, BOTTOM);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer unit-test-key');
    assert.equal(calls[1].url, 'https://api.fashn.ai/v1/status/pred_unit');
  } finally {
    globalThis.fetch = original;
  }
});
