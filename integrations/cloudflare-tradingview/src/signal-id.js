const encoder = new TextEncoder();

export async function createSignalId(signal) {
  const canonical = JSON.stringify([
    signal.source,
    signal.symbol,
    signal.rawSymbol,
    signal.exchange,
    signal.timeframe,
    signal.side,
    signal.price,
    signal.emittedAt,
    signal.strategy,
    signal.alertId
  ]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const hexadecimal = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `tv_${hexadecimal}`;
}
