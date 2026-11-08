import { executeTryOnPlan, planTryOn, stepTimeoutMs } from './fashn.js';

/** Optional outfit bottom. Empty means top-only. Non-strings are rejected. */
export function readBottomImage(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error('invalid_image_url');
  return value.trim();
}

function imageDataUrl(downloaded) {
  return `data:${downloaded.contentType};base64,${downloaded.buffer.toString('base64')}`;
}

/**
 * Virtual-model and Your-photo try-on, including optional outfit bottoms.
 * Does not rate-limit: one client POST is counted once by the caller, even
 * when an outfit runs two FASHN steps.
 */
export async function runTryOnRequest({
  body,
  requestTimeoutMs,
  fetchRemoteImage,
  validateShopperImage,
  cacheKey,
  readCached,
  writeCached,
  cachePublicPath,
  downloadResultImage,
  runTryOn,
}) {
  const productImage = body?.productImage;
  const modelImage = body?.modelImage;
  const shopperImage = body?.shopperImage;
  const lookupOnly = body?.lookupOnly === true;
  const bottomImage = readBottomImage(body?.bottomImage);

  if (!productImage || typeof productImage !== 'string') throw new Error('product_image_required');
  if (!modelImage && !shopperImage) throw new Error('model_or_shopper_required');
  if (modelImage && shopperImage) throw new Error('choose_one_person_image');
  if (lookupOnly && (shopperImage || !modelImage)) throw new Error('lookup_virtual_only');

  const plan = planTryOn({ bottomImage });
  const virtual = Boolean(modelImage) && !shopperImage;

  if (virtual) {
    let key;
    try {
      key = cacheKey(productImage, modelImage, bottomImage);
    } catch {
      throw new Error('invalid_image_url');
    }

    const hit = readCached(key);
    if (hit) {
      console.log(JSON.stringify({ event: 'tryon_cache', result: 'hit', lookupOnly }));
      return {
        status: 200,
        body: {
          imageUrl: cachePublicPath(key),
          imageDataUrl: imageDataUrl(hit),
          cached: true,
        },
      };
    }

    if (lookupOnly) {
      console.log(JSON.stringify({ event: 'tryon_cache', result: 'miss', lookupOnly: true }));
      return { status: 200, body: { cached: false } };
    }

    console.log(JSON.stringify({ event: 'tryon_cache', result: 'miss', lookupOnly: false }));
  }

  const garment = await fetchRemoteImage(productImage);
  // Bottom is a Shopify CDN image. The intermediate FASHN result is not fetched here.
  const bottom = plan.outfit ? await fetchRemoteImage(bottomImage) : '';
  const person = shopperImage
    ? await validateShopperImage(shopperImage)
    : await fetchRemoteImage(modelImage);

  const outcome = await executeTryOnPlan({
    plan,
    personImage: person,
    productImage: garment,
    bottomImage: bottom,
    timeoutMs: stepTimeoutMs(requestTimeoutMs, plan),
    run: runTryOn,
  });

  if (outcome.bottomsFailed) {
    console.log(JSON.stringify({
      event: 'bottoms_failed',
      code: outcome.code || 'bottoms_failed',
    }));
  }

  // Cache only a finished outfit or top. A tops-only fallback must not stick.
  if (virtual && !outcome.bottomsFailed) {
    const key = cacheKey(productImage, modelImage, bottomImage);
    const downloaded = await downloadResultImage(outcome.result.imageUrl);
    writeCached(key, downloaded.buffer);
    console.log(JSON.stringify({ event: 'tryon_cache', result: 'stored' }));
    return {
      status: 200,
      body: {
        imageUrl: outcome.result.imageUrl,
        imageDataUrl: imageDataUrl(downloaded),
        cached: false,
      },
    };
  }

  if (virtual && outcome.bottomsFailed) {
    let downloaded;
    try {
      downloaded = await downloadResultImage(outcome.result.imageUrl);
    } catch {
      downloaded = null;
    }
    return {
      status: 200,
      body: {
        imageUrl: outcome.result.imageUrl,
        ...(downloaded ? { imageDataUrl: imageDataUrl(downloaded) } : {}),
        cached: false,
      },
    };
  }

  return { status: 200, body: { imageUrl: outcome.result.imageUrl } };
}
