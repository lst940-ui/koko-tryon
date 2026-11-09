import test from 'node:test';
import assert from 'node:assert/strict';
import { productRefFromImageUrl, optionalProductFields, buildTryOnUsageLog } from '../src/usage-log.js';

test('productRefFromImageUrl extracts Shopify CDN file and path', () => {
  const ref = productRefFromImageUrl(
    'https://koko077.com/cdn/shop/files/XWY018-AZTEC01-01front.jpg?v=1793795721&width=480',
  );
  assert.equal(ref.productImageFile, 'XWY018-AZTEC01-01front.jpg');
  assert.equal(ref.productImagePath, '/cdn/shop/files/XWY018-AZTEC01-01front.jpg');
});

test('productRefFromImageUrl accepts protocol-relative URLs', () => {
  const ref = productRefFromImageUrl('//koko077.com/cdn/shop/files/foo-bar.jpg?v=1');
  assert.equal(ref.productImageFile, 'foo-bar.jpg');
});

test('optionalProductFields ignores missing and trims', () => {
  assert.deepEqual(optionalProductFields({}), {});
  assert.equal(optionalProductFields({ handle: '  gold-cross  ' }).handle, 'gold-cross');
});

test('buildTryOnUsageLog never includes image bodies', () => {
  const line = buildTryOnUsageLog({
    result: 'miss',
    lookupOnly: true,
    productImage: 'https://koko077.com/cdn/shop/files/XWY018.jpg',
    bottomImage: '',
    shopperImage: 'data:image/jpeg;base64,AAAA',
    body: {},
  });
  const raw = JSON.stringify(line);
  assert.equal(line.person, 'shopper');
  assert.equal(line.outfit, false);
  assert.ok(!raw.includes('data:image'));
  assert.ok(!raw.includes('AAAA'));
});
