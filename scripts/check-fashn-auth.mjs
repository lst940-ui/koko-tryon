import { dryAuthCheck } from '../src/fashn.js';

const key = process.env.FASHN_API_KEY;
const result = await dryAuthCheck(key);
// Yes/no style only. Never print the key or Authorization material.
if (!result.ok) {
  console.log(`FASHN_AUTH_OK=no reason=${result.reason || 'unknown'} status=${result.status || 'n/a'}`);
  process.exitCode = 1;
} else {
  console.log(`FASHN_AUTH_OK=yes status=${result.status}`);
}
