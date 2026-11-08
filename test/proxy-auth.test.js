import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyAppProxySignature, isAllowedShop } from '../src/proxy-auth.js';

function sign(params, secret) {
  const entries = Object.entries(params)
    .filter(([k]) => k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('');
  return crypto.createHmac('sha256', secret).update(entries).digest('hex');
}

test('accepts valid Shopify app proxy signatures', () => {
  const secret = 'hush';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = {
    shop: 'i13ur2-10.myshopify.com',
    logged_in_customer_id: '',
    path_prefix: '/apps/koko-tryon',
    timestamp,
  };
  params.signature = sign(params, secret);
  const qs = new URLSearchParams(params).toString();
  const result = verifyAppProxySignature(`https://example.com/apps/koko-tryon?${qs}`, secret);
  assert.equal(result.ok, true);
  assert.equal(result.shop, 'i13ur2-10.myshopify.com');
});

test('rejects tampered signatures and foreign shops', () => {
  const secret = 'hush';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = {
    shop: 'evil.myshopify.com',
    logged_in_customer_id: '',
    path_prefix: '/apps/koko-tryon',
    timestamp,
    signature: 'deadbeef',
  };
  const qs = new URLSearchParams(params).toString();
  assert.equal(verifyAppProxySignature(`https://example.com/x?${qs}`, secret).ok, false);
  assert.equal(isAllowedShop('evil.myshopify.com', new Set(['i13ur2-10.myshopify.com'])), false);
  assert.equal(isAllowedShop('i13ur2-10.myshopify.com', new Set(['i13ur2-10.myshopify.com', 'koko077.com'])), true);
});
