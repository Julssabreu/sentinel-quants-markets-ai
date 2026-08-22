import { ValidationError } from './errors.js';
import { normalizeTimeframe } from './normalize.js';

const encoder = new TextEncoder();

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError(field, `${field} debe ser texto.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new ValidationError(field, `${field} excede la longitud permitida.`);
  return normalized;
}

function safeIdentifier(value, field, maxLength) {
  const normalized = optionalText(value, field, maxLength);
  if (!normalized) return null;
  if (!/^[A-Za-z0-9._:/!-]+$/.test(normalized)) {
    throw new ValidationError(field, `${field} contiene caracteres no permitidos.`);
  }
  return normalized.toUpperCase();
}

function finiteNumber(value, field, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(field, `${field} es obligatorio.`);
    return null;
  }
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || Math.abs(number) > 1e15) {
    throw new ValidationError(field, `${field} debe ser un numero finito.`);
  }
  return number;
}

function timestamp(value, receivedAt) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('observed_at', 'observed_at es obligatorio.');
  }
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))
    ? Number(value)
    : null;
  const date = numeric === null
    ? new Date(String(value).trim())
    : new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
  if (!Number.isFinite(date.getTime())) {
    throw new ValidationError('observed_at', 'observed_at no contiene una fecha valida.');
  }
  if (date.getTime() > Date.parse(receivedAt) + 5 * 60_000) {
    throw new ValidationError('observed_at', 'observed_at no puede estar mas de cinco minutos en el futuro.');
  }
  return date.toISOString();
}

function metadata(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value !== 'object') {
    throw new ValidationError('metadata', 'metadata debe ser un objeto JSON.');
  }
  const serialized = JSON.stringify(value);
  if (encoder.encode(serialized).byteLength > 4096) {
    throw new ValidationError('metadata', 'metadata supera el limite de 4 KB.');
  }
  return serialized;
}

export function isVixDailyObservation(payload) {
  const raw = String(payload.ticker ?? payload.raw_symbol ?? payload.rawSymbol ?? '').trim().toUpperCase();
  const ticker = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  const interval = String(payload.timeframe ?? payload.interval ?? '').trim().toUpperCase();
  return ticker === 'VIX' && ['D', '1D', 'D1'].includes(interval);
}

export function normalizeMarketObservation(payload, receivedAt) {
  for (const field of ['side', 'action', 'order_action']) {
    if (payload[field] !== undefined && payload[field] !== null && payload[field] !== '') {
      throw new ValidationError(field, 'Una observacion de mercado no acepta BUY/SELL.');
    }
  }

  const rawSymbol = safeIdentifier(payload.ticker ?? payload.raw_symbol ?? payload.rawSymbol, 'ticker', 128);
  if (!rawSymbol) throw new ValidationError('ticker', 'ticker es obligatorio.');
  const colonIndex = rawSymbol.lastIndexOf(':');
  const exchange = safeIdentifier(payload.exchange ?? (colonIndex > 0 ? rawSymbol.slice(0, colonIndex) : null), 'exchange', 64);
  const open = finiteNumber(payload.open, 'open');
  const high = finiteNumber(payload.high, 'high');
  const low = finiteNumber(payload.low, 'low');
  const close = finiteNumber(payload.close, 'close');
  if (high < low || high < open || high < close || low > open || low > close) {
    throw new ValidationError('high', 'OHLC no forma una vela valida.');
  }
  const volume = finiteNumber(payload.volume, 'volume', false);
  if (volume !== null && volume < 0) throw new ValidationError('volume', 'volume no puede ser negativo.');

  return {
    source: 'TRADINGVIEW',
    rawSymbol,
    exchange,
    marketType: safeIdentifier(payload.market_type ?? payload.marketType, 'market_type', 32),
    timeframe: normalizeTimeframe(payload.timeframe ?? payload.interval),
    observedAt: timestamp(payload.observed_at ?? payload.observedAt ?? payload.timestamp ?? payload.time, receivedAt),
    open,
    high,
    low,
    close,
    volume,
    currency: safeIdentifier(payload.currency, 'currency', 16),
    baseCurrency: safeIdentifier(payload.base_currency ?? payload.baseCurrency, 'base_currency', 16),
    receivedAt,
    metadataJson: metadata(payload.metadata)
  };
}

export async function createMarketObservationId(observation) {
  const canonical = JSON.stringify([
    observation.source,
    observation.rawSymbol,
    observation.timeframe,
    observation.observedAt
  ]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `obs_${hex}`;
}
