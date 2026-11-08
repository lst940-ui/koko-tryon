const BASE = 'https://api.fashn.ai/v1';

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export function resolveCategory(category) {
  return category === 'bottoms' ? 'bottoms' : 'tops';
}

export async function runTryOn({
  apiKey,
  modelImage,
  garmentImage,
  category = 'tops',
  modelName = 'tryon-v1.6',
  mode = 'performance',
  timeoutMs = 85_000,
}) {
  if (!apiKey) throw new Error('fashn_key_missing');
  const started = Date.now();
  const runResponse = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      model_name: modelName,
      inputs: {
        model_image: modelImage,
        garment_image: garmentImage,
        category: resolveCategory(category),
        garment_photo_type: 'auto',
        mode,
        num_samples: 1,
        output_format: 'jpeg',
        return_base64: false,
        moderation_level: 'permissive',
      },
    }),
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
    await new Promise((r) => setTimeout(r, 2000));
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
