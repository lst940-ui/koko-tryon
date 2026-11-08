import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCategory } from '../src/fashn.js';

test('resolveCategory only allows tops or bottoms', () => {
  assert.equal(resolveCategory('tops'), 'tops');
  assert.equal(resolveCategory('bottoms'), 'bottoms');
  assert.equal(resolveCategory(undefined), 'tops');
  assert.equal(resolveCategory('auto'), 'tops');
  assert.equal(resolveCategory('full-body'), 'tops');
});
