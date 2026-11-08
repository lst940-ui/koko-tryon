function required(name, optional = false) {
  const value = process.env[name];
  if (!value && !optional) throw new Error(`${name} is required`);
  return value || '';
}

function assembledEnv(name) {
  const chunks = ['A', 'B', 'C', 'D', 'E']
    .map((part) => process.env[`${name}_${part}`] || '')
    .join('');
  return chunks || process.env[name] || '';
}

export function loadConfig() {
  const shops = (process.env.ALLOWED_SHOPS || 'i13ur2-10.myshopify.com,koko077.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    port: Number(process.env.PORT || 8787),
    shopifyApiSecret: assembledEnv('SHOPIFY_API_SECRET'),
    allowedShops: new Set(shops),
    fashnApiKey: assembledEnv('FASHN_API_KEY'),
    fashnModel: process.env.FASHN_MODEL || 'tryon-v1.6',
    fashnMode: process.env.FASHN_MODE || 'performance',
    maxRequestsPerMinute: Number(process.env.MAX_REQUESTS_PER_MINUTE || 8),
    maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 9_000_000),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 85_000),
    allowedCdnHosts: [
      'cdn.shopify.com',
      'cdn.shopifycdn.net',
      /^(?:[a-z0-9-]+\.)*shopify\.com$/i,
      /^(?:[a-z0-9-]+\.)*myshopify\.com$/i,
      'koko077.com',
      'www.koko077.com',
    ],
  };
}
