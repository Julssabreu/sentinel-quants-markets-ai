const encoder = new TextEncoder();

export const TRADINGVIEW_WEBHOOK_IPS = new Set([
  '52.89.214.238',
  '34.212.75.30',
  '54.218.53.128',
  '52.32.178.7'
]);

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;

  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export function hasValidBodySecret(payload, expectedSecret) {
  return constantTimeEqual(payload?.secret, expectedSecret);
}

export function extractBearerToken(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer[ \t]+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function hasValidBearer(request, expectedToken) {
  const suppliedToken = extractBearerToken(request.headers.get('authorization'));
  return constantTimeEqual(suppliedToken, expectedToken);
}

export function hasValidTradingViewIp(request, allowNonTradingViewIps = false) {
  if (allowNonTradingViewIps) return true;
  const connectingIp = request.headers.get('cf-connecting-ip');
  return typeof connectingIp === 'string' && TRADINGVIEW_WEBHOOK_IPS.has(connectingIp.trim());
}
