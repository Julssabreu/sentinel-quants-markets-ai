import { ValidationError } from './errors.js';

const MAX_METADATA_BYTES = 4 * 1024;
const encoder = new TextEncoder();

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

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('observed_at', 'observed_at o timestamp es obligatorio.');
  }

  let date;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    date = new Date(milliseconds);
  } else if (typeof value === 'string') {
    date = new Date(value.trim());
  } else {
    throw new ValidationError('observed_at', 'observed_at debe ser una fecha ISO o epoca Unix.');
  }

  if (!Number.isFinite(date.getTime())) {
    throw new ValidationError('observed_at', 'observed_at no contiene una fecha valida.');
  }
  return date.toISOString();
}

function normalizeObservationDate(value, observedAt) {
  if (value === undefined || value === null || value === '') {
    return observedAt.slice(0, 10);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new ValidationError('observation_date', 'observation_date debe usar YYYY-MM-DD.');
  }

  const normalized = value.trim();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new ValidationError('observation_date', 'observation_date no contiene una fecha valida.');
  }
  if (normalized !== observedAt.slice(0, 10)) {
    throw new ValidationError(
      'observation_date',
      'observation_date debe coincidir con la fecha UTC de observed_at.'
    );
  }
  return normalized;
}

function normalizeLevel(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(field, `${field} es obligatorio.`);
    return null;
  }

  const level = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(level) || level <= 0 || level > 1000) {
    throw new ValidationError(field, `${field} debe ser un numero positivo menor o igual a 1000.`);
  }
  return level;
}

function normalizeExchange(value, inferredExchange) {
  const exchange = optionalText(value ?? inferredExchange, 'exchange', 64);
  if (!exchange) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(exchange)) {
    throw new ValidationError('exchange', 'exchange contiene caracteres no permitidos.');
  }
  return exchange.toUpperCase();
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value !== 'object') {
    throw new ValidationError('metadata', 'metadata debe ser un objeto JSON.');
  }

  const serialized = JSON.stringify(value);
  if (encoder.encode(serialized).byteLength > MAX_METADATA_BYTES) {
    throw new ValidationError('metadata', 'metadata supera el limite de 4 KB.');
  }
  return serialized;
}

function rejectOperationalFields(payload) {
  for (const field of ['side', 'action', 'order_action']) {
    if (payload[field] !== undefined && payload[field] !== null && payload[field] !== '') {
      throw new ValidationError(
        field,
        `${field} no pertenece al contexto VIX; esta ruta no acepta senales BUY/SELL.`
      );
    }
  }
}

export function normalizeVixDailyPayload(payload, receivedAt) {
  rejectOperationalFields(payload);

  const rawSymbol = optionalText(
    payload.ticker ?? payload.raw_symbol ?? payload.rawSymbol,
    'ticker',
    128
  );
  if (!rawSymbol) throw new ValidationError('ticker', 'ticker es obligatorio para el contexto VIX.');
  if (!/^[A-Za-z0-9._:-]+$/.test(rawSymbol)) {
    throw new ValidationError('ticker', 'ticker contiene caracteres no permitidos.');
  }

  const colonIndex = rawSymbol.lastIndexOf(':');
  const inferredExchange = colonIndex > 0 ? rawSymbol.slice(0, colonIndex) : null;
  const ticker = (colonIndex > 0 ? rawSymbol.slice(colonIndex + 1) : rawSymbol).toUpperCase();
  if (ticker !== 'VIX') {
    throw new ValidationError('ticker', 'Esta ruta acepta unicamente el indice VIX.');
  }

  const timeframe = String(payload.timeframe ?? payload.interval ?? '').trim().toUpperCase();
  if (!['D', '1D', 'D1'].includes(timeframe)) {
    throw new ValidationError('timeframe', 'El contexto VIX debe provenir de una vela diaria.');
  }

  const observedAt = normalizeTimestamp(
    payload.observed_at ?? payload.observedAt ?? payload.timestamp ?? payload.time
  );
  if (Date.parse(observedAt) > Date.parse(receivedAt) + 5 * 60_000) {
    throw new ValidationError('observed_at', 'observed_at no puede estar mas de cinco minutos en el futuro.');
  }
  const observationDate = normalizeObservationDate(
    payload.observation_date ?? payload.observationDate,
    observedAt
  );
  const close = normalizeLevel(payload.close, 'close');
  const value = normalizeLevel(payload.value ?? payload.close, 'value', true);
  if (close !== null && close !== value) {
    throw new ValidationError('value', 'value y close deben representar el mismo cierre diario.');
  }

  const open = normalizeLevel(payload.open, 'open');
  const high = normalizeLevel(payload.high, 'high');
  const low = normalizeLevel(payload.low, 'low');
  if (high !== null && low !== null && high < low) {
    throw new ValidationError('high', 'high no puede ser menor que low.');
  }
  if (high !== null && (value > high || (open !== null && open > high))) {
    throw new ValidationError('high', 'high debe cubrir el cierre y la apertura informados.');
  }
  if (low !== null && (value < low || (open !== null && open < low))) {
    throw new ValidationError('low', 'low debe cubrir el cierre y la apertura informados.');
  }

  return {
    source: 'TRADINGVIEW',
    symbol: 'VIX',
    rawSymbol,
    exchange: normalizeExchange(payload.exchange, inferredExchange),
    timeframe: 'D1',
    observationDate,
    value,
    open,
    high,
    low,
    close,
    observedAt,
    receivedAt,
    metadataJson: normalizeMetadata(payload.metadata)
  };
}

export async function createVixDailyId(observation) {
  const canonical = JSON.stringify([
    observation.source,
    observation.symbol,
    observation.observationDate
  ]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const hexadecimal = Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0')
  ).join('');
  return `vix_${hexadecimal}`;
}
