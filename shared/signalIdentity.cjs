const { createHash } = require('crypto');
const { stableJson } = require('./evidenceLedger.cjs');

function normalizedSource(value) {
  return String(value || '').trim().toUpperCase();
}

function signalIdentity(payload = {}) {
  const source = normalizedSource(payload.source);
  const sourceSignalId = String(payload.sourceSignalId || payload.atomicSignalId || '').trim();
  if (source && sourceSignalId) return { source, sourceSignalId };
  const fallback = {
    source,
    symbol: String(payload.brokerSymbol || payload.symbol || '').trim().toUpperCase(),
    timeframe: String(payload.timeframe || '').trim().toUpperCase(),
    observedAt: String(payload.sourceTimestamp || payload.observedAt || payload.signalTimestamp || '').trim(),
    direction: String(payload.direction || payload.signal || payload.action || '').trim().toUpperCase(),
  };
  if (!fallback.source || !fallback.symbol || !fallback.timeframe || !fallback.observedAt) {
    throw new Error('La señal no tiene identidad estable suficiente para deduplicarse.');
  }
  return fallback;
}

function canonicalSignalFingerprint(payload) {
  return `SENTINEL-${createHash('sha256').update(stableJson(signalIdentity(payload))).digest('hex')}`;
}

function sameSignalIdentity(left, right) {
  try { return stableJson(signalIdentity(left)) === stableJson(signalIdentity(right)); } catch { return false; }
}

function parseLegacyRetryIdentity(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(ATOMIC|TRADINGVIEW)_VALIDATION\|(.+)$/i);
  if (!match) return null;
  return { source: match[1].toUpperCase(), sourceSignalId: match[2] };
}

module.exports = { signalIdentity, canonicalSignalFingerprint, sameSignalIdentity, parseLegacyRetryIdentity };
