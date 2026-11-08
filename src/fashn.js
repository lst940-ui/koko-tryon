const BASE = 'https://api.fashn.ai/v1';

/** tryon-v1.6 applies one garment per run. Category picks which piece. */
export const TRYON_CATEGORIES = new Set(['auto', 'tops', 'bottoms', 'one-pieces']);

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export function buildRunBody({
  modelName,
  modelImage,
  garmentImage,
  category = 'tops',
  mode,
}) {
  const resolved = category || 'tops';
  if (!TRYON_CATEGORIES.has(resolved)) throw new Error('invalid_category');
  return {
    model_name: modelName,
    inputs: {
      model_image: modelImage,
      garment_image: garmentImage,
      category: resolved,
      garment_photo_type: 'auto',
      mode,
      num_samples: 1,
      output_format: 'jpeg',
      return_base64: false,
      moderation_level: 'permissive',
    },
  };
}

/**
 * Top-only products are one tops run.
 * Outfit sets are tops (productImage) then bottoms (bottomImage).
 * v1.6 has no multi-garment input; category selects the piece when a photo shows both.
 */
export function planTryOn({ bottomImage } = {}) {
  const bottom = typeof bottomImage === 'string' ? bottomImage.trim() : '';
  if (!bottom) {
    return {
      outfit: false,
      steps: [{ category: 'tops', garmentSource: 'product' }],
    };
  }
  return {
    outfit: true,
    steps: [
      { category: 'tops', garmentSource: 'product' },
      { category: 'bottoms', garmentSource: 'bottom' },
    ],
  };
}

/** Default 85s per step. An outfit is two sequential steps, about 170s total. */
export function tryOnBudgetMs(requestTimeoutMs, plan) {
  const per = Number(requestTimeoutMs);
  const stepMs = Number.isFinite(per) && per > 0 ? per : 85_000;
  const steps = plan?.steps?.length || 1;
  return stepMs * steps;
}

export function stepTimeoutMs(requestTimeoutMs, plan) {
  const steps = plan?.steps?.length || 1;
  return Math.floor(tryOnBudgetMs(requestTimeoutMs, plan) / steps);
}

/** Short stable codes only, so logs never pick up URLs or secrets. */
export function publicErrorCode(error) {
  const code = String(error?.message || 'bottoms_failed');
  if (/^[a-z][a-z0-9_]{0,63}$/i.test(code)) return code;
  return 'bottoms_failed';
}

/**
 * Run the plan. The bottoms step uses the tops result URL as the next person
 * image. Callers must not send that URL through the Shopify CDN allowlist.
 * A bottoms failure keeps the tops image.
 */
export async function executeTryOnPlan({
  plan,
  personImage,
  productImage,
  bottomImage,
  run,
  timeoutMs,
}) {
  if (!plan?.steps?.length) throw new Error('tryon_failed');
  let currentPerson = personImage;
  let last = null;
  for (const step of plan.steps) {
    const garmentImage = step.garmentSource === 'bottom' ? bottomImage : productImage;
    if (!garmentImage) throw new Error('product_image_required');
    try {
      const result = await run({
        modelImage: currentPerson,
        garmentImage,
        category: step.category,
        timeoutMs,
      });
      const imageUrl = result?.imageUrl ? String(result.imageUrl) : '';
      if (!imageUrl.startsWith('https://')) throw new Error('fashn_missing_output');
      last = { imageUrl, predictionId: result.predictionId };
      currentPerson = imageUrl;
    } catch (error) {
      if (step.garmentSource === 'bottom' && last) {
        return { result: last, bottomsFailed: true, code: publicErrorCode(error) };
      }
      throw error;
    }
  }
  return { result: last, bottomsFailed: false };
}

export async function runTryOn({
  apiKey,
  modelImage,
  garmentImage,
  category = 'tops',
  modelName = 'tryon-v1.6',
  mode = 'performance',
  timeoutMs = 85_000,
  pollIntervalMs = 2_000,
}) {
  if (!apiKey) throw new Error('fashn_key_missing');
  const started = Date.now();
  const runResponse = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(buildRunBody({
      modelName,
      modelImage,
      garmentImage,
      category,
      mode,
    })),
  });
  const runJson = await runResponse.json().catch(() => ({}));
  if (!runResponse.ok || !runJson.id) {
    const err = new Error('fashn_run_failed');
    err.status = runResponse.status;
    err.code = runJson?.error?.name || 'run_failed';
    throw err;
  }

  const predictionId = runJson.id;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const statusResponse = await fetch(`${BASE}/status/${encodeURIComponent(predictionId)}`, {
      headers: authHeaders(apiKey),
    });
    const statusJson = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) {
      const err = new Error('fashn_status_failed');
      err.status = statusResponse.status;
      throw err;
    }
    if (statusJson.status === 'completed') {
      const imageUrl = Array.isArray(statusJson.output) ? statusJson.output[0] : null;
      if (!imageUrl || !String(imageUrl).startsWith('https://')) {
        throw new Error('fashn_missing_output');
      }
      return { imageUrl: String(imageUrl), predictionId };
    }
    if (statusJson.status === 'failed') {
      const err = new Error('fashn_failed');
      err.code = statusJson?.error?.name || 'failed';
      throw err;
    }
  }
  const err = new Error('fashn_timeout');
  err.code = 'timeout';
  throw err;
}

/** Dry auth probe: hits status for a nonexistent id. Does not start a paid generation. */
export async function dryAuthCheck(apiKey) {
  if (!apiKey) return { ok: false, reason: 'missing_key' };
  const response = await fetch(`${BASE}/status/00000000-0000-0000-0000-000000000000`, {
    headers: authHeaders(apiKey),
  });
  // 401/403 => bad key. 404/400/200 with failed/not found => key accepted by API gateway.
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'unauthorized', status: response.status };
  }
  return { ok: true, status: response.status };
}
