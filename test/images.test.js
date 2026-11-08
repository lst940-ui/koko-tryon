import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { assertSafePublicImageUrl, validateDataUrlImage } from '../src/images.js';

const hosts = ['cdn.shopify.com', 'koko077.com', /^(?:[a-z0-9-]+\.)*myshopify\.com$/i];

test('blocks SSRF and non-CDN hosts', () => {
  assert.throws(() => assertSafePublicImageUrl('http://cdn.shopify.com/x.jpg', hosts));
  assert.throws(() => assertSafePublicImageUrl('https://127.0.0.1/x.jpg', hosts));
  assert.throws(() => assertSafePublicImageUrl('https://evil.example/x.jpg', hosts));
  assert.equal(
    assertSafePublicImageUrl('https://cdn.shopify.com/s/files/1/x.jpg?width=1600', hosts),
    'https://cdn.shopify.com/s/files/1/x.jpg?width=1600'
  );
});

test('accepts and re-encodes shopper data URLs without logging them', async () => {
  const png = await sharp({
    create: { width: 32, height: 48, channels: 3, background: { r: 20, g: 30, b: 40 } },
  }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const cleaned = await validateDataUrlImage(dataUrl);
  assert.match(cleaned, /^data:image\/png;base64,/);
  await assert.rejects(() => validateDataUrlImage('data:text/plain;base64,aaaa'));
});
