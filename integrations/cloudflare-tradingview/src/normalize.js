import { ValidationError } from './errors.js';

export const TRADINGVIEW_TO_SENTINEL = Object.freeze({
  '1': 'M1',
  '2': 'M2',
  '3': 'M3',
  '4': 'M4',
  '5': 'M5',
  '6': 'M6',
  '10': 'M10',
  '12': 'M12',
  '15': 'M15',
  '20': 'M20',
  '30': 'M30',
  '60': 'H1',
  '120': 'H2',
  '180': 'H3',
  '240': 'H4',
  '360': 'H6',
  '480': 'H8',
  '720': 'H12',
  D: 'D1',
  W: 'W1',
  M: 'MN1'
});

const SENTINEL_TIMEFRAMES = new Set(Object.values(TRADINGVIEW_TO_SENTINEL));
const TEXT_LIMITS = Object.freeze({
  rawSymbol: 128,
  exchange: 64,
  symbol: 64,
  strategy: 160,
  alertId: 200,
  verdict: 160,
  detail: 2000
});

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} debe ser texto.`);
  }

  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new ValidationError(field, `${field} excede la longitud permitida.`);
  }
  return normalized;
}

export function normalizeSide(value) {
  if (typeof value !== 'string') {
    throw new ValidationError('side', 'La dirección de la señal es obligatoria.');
  }

  const side = value.trim().toUpperCase();
  if (side === 'BUY' || side === 'LONG') return 'BUY';
  if (side === 'SELL' || side === 'SHORT') return 'SELL';
  throw new ValidationError('side', 'La dirección debe ser BUY o SELL.');
}

export function normalizeTimeframe(value) {
  if (value === undefined || value === null) {
    throw new ValidationError('timeframe', 'La temporalidad es obligatoria.');
  }

  const raw = String(value).trim();
  if (!raw) throw new ValidationError('timeframe', 'La temporalidad es obligatoria.');

  if (raw === '1M') return 'MN1';
  if (TRADINGVIEW_TO_SENTINEL[raw]) return TRADINGVIEW_TO_SENTINEL[raw];

  const upper = raw.toUpperCase();
  if (SENTINEL_TIMEFRAMES.has(upper)) return upper;
  if (upper === '1D') return 'D1';
  if (upper === '1W') return 'W1';
  if (upper === '1MO' || upper === '1MON' || upper === 'MONTH') return 'MN1';

  const minuteMatch = raw.match(/^(\d+)(?:m|min)$/i);
  if (minuteMatch && TRADINGVIEW_TO_SENTINEL[minuteMatch[1]]) {
    return TRADINGVIEW_TO_SENTINEL[minuteMatch[1]];
  }

  const hourMatch = raw.match(/^(\d+)(?:h|hr)$/i);
  if (hourMatch) {
    const minutes = String(Number(hourMatch[1]) * 60);
    if (TRADINGVIEW_TO_SENTINEL[minutes]) return TRADINGVIEW_TO_SENTINEL[minutes];
  }

  throw new ValidationError('timeframe', 'La temporalidad no pertenece a las 21 temporalidades de Sentinel.');
}

function normalizeExchange(payloadExchange, inferredExchange) {
  const exchange = optionalText(
    payloadExchange ?? inferredExchange,
    'exchange',
    TEXT_LIMITS.exchange
  );
  if (!exchange) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(exchange)) {
    throw new ValidationError('exchange', 'exchange contiene caracteres no permitidos.');
  }
  return exchange.toUpperCase();
}

function normalizeSymbol(value) {
  const symbol = optionalText(value, 'symbol', TEXT_LIMITS.symbol);
  if (!symbol) throw new ValidationError('symbol', 'El símbolo es obligatorio.');

  const upper = symbol.toUpperCase().replace(/\s+/g, '').replace(/(?:\.P|PERP)$/i, '');
  const converted = upper.endsWith('USDT') ? `${upper.slice(0, -4)}USD` : upper;
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(converted)) {
    throw new ValidationError('symbol', 'El símbolo contiene caracteres no permitidos.');
  }
  return converted;
}

function normalizePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const price = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(price) || price <= 0) {
    throw new ValidationError('price', 'price debe ser un número positivo.');
  }
  return price;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;

  let date;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    date = new Date(milliseconds);
  } else if (typeof value === 'string') {
    date = new Date(value.trim());
  } else {
    throw new ValidationError('timestamp', 'timestamp debe ser una fecha ISO o época Unix.');
  }

  if (!Number.isFinite(date.getTime())) {
    throw new ValidationError('timestamp', 'timestamp no contiene una fecha válida.');
  }
  return date.toISOString();
}

export function normalizeTradingViewPayload(payload, receivedAt) {
  const ticker = optionalText(
    payload.ticker ?? payload.raw_symbol ?? payload.rawSymbol,
    'ticker',
    TEXT_LIMITS.rawSymbol
  );
  const explicitSymbol = optionalText(
    payload.sentinel_symbol ?? payload.sentinelSymbol,
    'sentinel_symbol',
    TEXT_LIMITS.symbol
  );

  if (!ticker && !explicitSymbol) {
    throw new ValidationError('ticker', 'ticker o sentinel_symbol es obligatorio.');
  }

  const rawSymbol = ticker ?? explicitSymbol;
  const colonIndex = ticker?.lastIndexOf(':') ?? -1;
  const inferredExchange = colonIndex > 0 ? ticker.slice(0, colonIndex) : null;
  const tickerWithoutExchange = colonIndex > 0 ? ticker.slice(colonIndex + 1) : ticker;
  const sideInput = payload.action ?? payload.side ?? payload.order_action;
  const timeframeInput = payload.timeframe ?? payload.interval;
  const timestampInput = payload.timestamp ?? payload.emitted_at ?? payload.emittedAt ?? payload.time ?? payload.timenow;
  const emittedAt = normalizeTimestamp(timestampInput);
  const alertId = optionalText(payload.alert_id ?? payload.alertId, 'alert_id', TEXT_LIMITS.alertId);

  if (!emittedAt && !alertId) {
    throw new ValidationError('timestamp', 'timestamp o alert_id es obligatorio para deduplicar la señal.');
  }

  const symbol = normalizeSymbol(explicitSymbol ?? tickerWithoutExchange);
  if (symbol === 'VIX') {
    throw new ValidationError(
      'ticker',
      'VIX pertenece al contexto diario y debe enviarse a /webhooks/tradingview/vix sin BUY/SELL.'
    );
  }

  return {
    source: 'TRADINGVIEW',
    symbol,
    rawSymbol,
    exchange: normalizeExchange(payload.exchange, inferredExchange),
    timeframe: normalizeTimeframe(timeframeInput),
    side: normalizeSide(sideInput),
    price: normalizePrice(payload.price ?? payload.close ?? payload.order_price),
    emittedAt,
    receivedAt,
    strategy: optionalText(
      payload.strategy ?? payload.strategy_name ?? payload.strategyName,
      'strategy',
      TEXT_LIMITS.strategy
    ),
    alertId
  };
}

export function normalizeAckPayload(payload) {
  if (typeof payload.status !== 'string') {
    throw new ValidationError('status', 'status es obligatorio.');
  }

  const status = payload.status.trim().toUpperCase();
  if (!['PROCESSED', 'EXPIRED', 'REJECTED', 'RETRY'].includes(status)) {
    throw new ValidationError('status', 'status debe ser PROCESSED, EXPIRED, REJECTED o RETRY.');
  }

  const leaseToken = optionalText(payload.leaseToken ?? payload.lease_token, 'leaseToken', 80);
  if (!leaseToken || !/^[a-f0-9-]{36}$/i.test(leaseToken)) {
    throw new ValidationError('leaseToken', 'leaseToken es obligatorio y debe ser un UUID.');
  }
  const retryAfterSeconds = status === 'RETRY'
    ? Math.max(10, Math.min(3600, Number(payload.retryAfterSeconds) || 60))
    : null;

  return {
    status,
    leaseToken,
    retryAfterSeconds,
    verdict: optionalText(payload.verdict, 'verdict', TEXT_LIMITS.verdict),
    detail: optionalText(payload.detail, 'detail', TEXT_LIMITS.detail)
  };
}
