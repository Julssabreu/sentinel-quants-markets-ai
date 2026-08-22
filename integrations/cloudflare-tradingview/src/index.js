import { hasValidBearer, hasValidBodySecret, hasValidTradingViewIp } from './auth.js';
import { readJsonObject } from './body.js';
import { RequestError } from './errors.js';
import { normalizeAckPayload, normalizeTradingViewPayload } from './normalize.js';
import {
  acknowledgeSignal,
  claimPendingSignals,
  checkDatabase,
  insertSignal,
  purgeTerminalSignals
} from './repository.js';
import { errorResponse, jsonResponse, methodNotAllowed } from './responses.js';
import { createSignalId } from './signal-id.js';
import { createVixDailyId, normalizeVixDailyPayload } from './vix.js';
import {
  checkVixDatabase,
  getVixHistory,
  purgeVixHistory,
  upsertVixDaily
} from './vix-repository.js';
import {
  createMarketObservationId,
  isVixDailyObservation,
  normalizeMarketObservation
} from './market-observation.js';
import {
  checkMarketObservationDatabase,
  getMarketObservations,
  purgeMarketObservations,
  upsertMarketObservation
} from './market-observation-repository.js';

const SIGNAL_ID_PATTERN = /^tv_[a-f0-9]{64}$/;
const SERVICE_ID = 'sentinel-tradingview-bridge';
const CONTRACT_VERSION = 3;

function hasWebhookConfiguration(env) {
  return typeof env.TRADINGVIEW_WEBHOOK_SECRET === 'string'
    && env.TRADINGVIEW_WEBHOOK_SECRET.length > 0
    && env.DB;
}

function hasConsumerConfiguration(env) {
  return typeof env.SENTINEL_CONSUMER_TOKEN === 'string'
    && env.SENTINEL_CONSUMER_TOKEN.length > 0
    && env.DB;
}

function requireConsumer(request, env) {
  if (!hasConsumerConfiguration(env)) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'El servicio no está configurado.');
  }
  if (!hasValidBearer(request, env.SENTINEL_CONSUMER_TOKEN)) {
    return errorResponse(
      401,
      'UNAUTHORIZED',
      'Credenciales inválidas.',
      null,
      { 'WWW-Authenticate': 'Bearer' }
    );
  }
  return null;
}

async function handleWebhook(request, env) {
  if (!hasWebhookConfiguration(env)) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'El servicio no está configurado.');
  }

  const allowNonTradingViewIps = env.ALLOW_NON_TRADINGVIEW_IPS === 'true';
  if (!hasValidTradingViewIp(request, allowNonTradingViewIps)) {
    return errorResponse(403, 'FORBIDDEN', 'Origen no permitido.');
  }

  const payload = await readJsonObject(request);
  if (!hasValidBodySecret(payload, env.TRADINGVIEW_WEBHOOK_SECRET)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Credenciales inválidas.');
  }

  const receivedAt = new Date().toISOString();
  const normalized = normalizeTradingViewPayload(payload, receivedAt);
  const id = await createSignalId(normalized);
  const accepted = await insertSignal(env.DB, { ...normalized, id });

  return jsonResponse(
    {
      ok: true,
      id,
      accepted,
      duplicate: !accepted
    },
    202
  );
}

async function handleVixWebhook(request, env) {
  if (!hasWebhookConfiguration(env)) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'El servicio no esta configurado.');
  }

  const allowNonTradingViewIps = env.ALLOW_NON_TRADINGVIEW_IPS === 'true';
  if (!hasValidTradingViewIp(request, allowNonTradingViewIps)) {
    return errorResponse(403, 'FORBIDDEN', 'Origen no permitido.');
  }

  const payload = await readJsonObject(request);
  if (!hasValidBodySecret(payload, env.TRADINGVIEW_WEBHOOK_SECRET)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Credenciales invalidas.');
  }

  const receivedAt = new Date().toISOString();
  const normalized = normalizeVixDailyPayload(payload, receivedAt);
  const id = await createVixDailyId(normalized);
  const accepted = await upsertVixDaily(env.DB, { ...normalized, id });

  return jsonResponse({
    ok: true,
    contextType: 'MARKET_CONTEXT',
    operationalSignal: false,
    id,
    observationDate: normalized.observationDate,
    accepted,
    duplicate: !accepted
  }, 202);
}

async function handleMarketObservationWebhook(request, env) {
  if (!hasWebhookConfiguration(env)) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'El servicio no esta configurado.');
  }
  const allowNonTradingViewIps = env.ALLOW_NON_TRADINGVIEW_IPS === 'true';
  if (!hasValidTradingViewIp(request, allowNonTradingViewIps)) {
    return errorResponse(403, 'FORBIDDEN', 'Origen no permitido.');
  }
  const payload = await readJsonObject(request);
  if (!hasValidBodySecret(payload, env.TRADINGVIEW_WEBHOOK_SECRET)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Credenciales invalidas.');
  }

  if (isVixDailyObservation(payload)) {
    const receivedAt = new Date().toISOString();
    const normalized = normalizeVixDailyPayload({ ...payload, value: payload.close }, receivedAt);
    const id = await createVixDailyId(normalized);
    const accepted = await upsertVixDaily(env.DB, { ...normalized, id });
    return jsonResponse({ ok:true, contextType:'MARKET_CONTEXT', operationalSignal:false, routedAs:'VIX_DAILY', id, accepted, duplicate:!accepted }, 202);
  }

  const receivedAt = new Date().toISOString();
  const normalized = normalizeMarketObservation(payload, receivedAt);
  const id = await createMarketObservationId(normalized);
  const accepted = await upsertMarketObservation(env.DB, { ...normalized, id });
  return jsonResponse({ ok:true, contextType:'MARKET_OBSERVATION', operationalSignal:false, routedAs:'MARKET_OBSERVATION', id, accepted, duplicate:!accepted }, 202);
}

async function handleHealth(request, env) {
  const authError = requireConsumer(request, env);
  if (authError) return authError;

  const [signalsHealthy, vixHealthy, observationsHealthy] = await Promise.all([
    checkDatabase(env.DB),
    checkVixDatabase(env.DB),
    checkMarketObservationDatabase(env.DB)
  ]);
  const healthy = signalsHealthy && vixHealthy && observationsHealthy;
  if (!healthy) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'La bandeja persistente no está disponible.');
  }
  return jsonResponse({
    ok: true,
    service: SERVICE_ID,
    contractVersion: CONTRACT_VERSION,
    checkedAt: new Date().toISOString()
  });
}

function normalizeVixLimit(searchParams) {
  for (const key of searchParams.keys()) {
    if (key !== 'limit') {
      throw new RequestError(400, 'INVALID_QUERY', 'Parametro de consulta no permitido.', key);
    }
  }

  const supplied = searchParams.getAll('limit');
  if (supplied.length > 1) {
    throw new RequestError(400, 'INVALID_QUERY', 'limit no puede repetirse.', 'limit');
  }
  if (supplied.length === 0) return 60;

  const raw = supplied[0];
  if (!/^\d+$/.test(raw)) {
    throw new RequestError(400, 'INVALID_QUERY', 'limit debe ser un entero entre 1 y 365.', 'limit');
  }
  const limit = Number(raw);
  if (limit < 1 || limit > 365) {
    throw new RequestError(400, 'INVALID_QUERY', 'limit debe ser un entero entre 1 y 365.', 'limit');
  }
  return limit;
}

async function handleVixContext(request, env, url) {
  const authError = requireConsumer(request, env);
  if (authError) return authError;

  const history = await getVixHistory(env.DB, normalizeVixLimit(url.searchParams));
  return jsonResponse({
    ok: true,
    contextType: 'MARKET_CONTEXT',
    symbol: 'VIX',
    operationalSignal: false,
    snapshot: history[0] ?? null,
    history,
    checkedAt: new Date().toISOString()
  });
}

async function handleMarketObservations(request, env, url) {
  const authError = requireConsumer(request, env);
  if (authError) return authError;
  for (const key of url.searchParams.keys()) {
    if (!['symbol', 'timeframe', 'limit'].includes(key)) {
      throw new RequestError(400, 'INVALID_QUERY', 'Parametro de consulta no permitido.', key);
    }
  }
  const rawSymbol = String(url.searchParams.get('symbol') ?? '').trim().toUpperCase();
  const symbol = rawSymbol.replace(/[^A-Z0-9.!-]/g, '');
  if (!symbol || symbol.length > 64) {
    throw new RequestError(400, 'INVALID_QUERY', 'symbol es obligatorio.', 'symbol');
  }
  const timeframeRaw = String(url.searchParams.get('timeframe') ?? '').trim().toUpperCase();
  const timeframe = timeframeRaw || null;
  if (timeframe && !/^(?:M(?:1|2|3|4|5|6|10|12|15|20|30)|H(?:1|2|3|4|6|8|12)|D1|W1|MN1)$/.test(timeframe)) {
    throw new RequestError(400, 'INVALID_QUERY', 'timeframe no es valido.', 'timeframe');
  }
  const limit = normalizeLimit(url.searchParams.get('limit'));
  const observations = await getMarketObservations(env.DB, { symbol, timeframe, limit });
  return jsonResponse({
    ok: true,
    contextType: 'MARKET_OBSERVATION',
    operationalSignal: false,
    symbol,
    timeframe,
    observations,
    checkedAt: new Date().toISOString()
  });
}

function normalizeLimit(value) {
  if (value === undefined || value === null) return 50;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new RequestError(400, 'INVALID_QUERY', 'limit debe ser un entero entre 1 y 100.', 'limit');
  }
  const limit = Number(raw);
  if (limit < 1 || limit > 100) {
    throw new RequestError(400, 'INVALID_QUERY', 'limit debe ser un entero entre 1 y 100.', 'limit');
  }
  return limit;
}

async function handleClaim(request, env) {
  const authError = requireConsumer(request, env);
  if (authError) return authError;

  const body = await readJsonObject(request);
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const signals = await claimPendingSignals(env.DB, {
    limit:normalizeLimit(body.limit),
    now:now.toISOString(),
    leaseToken,
    leaseUntil:new Date(now.getTime() + 5 * 60_000).toISOString()
  });
  return jsonResponse({ ok: true, signals, checkedAt: new Date().toISOString() });
}

async function handleAck(request, env, id) {
  const authError = requireConsumer(request, env);
  if (authError) return authError;
  if (!SIGNAL_ID_PATTERN.test(id)) {
    throw new RequestError(400, 'INVALID_SIGNAL_ID', 'El identificador de señal no es válido.', 'id');
  }

  const body = await readJsonObject(request);
  const acknowledgement = normalizeAckPayload(body);
  const result = await acknowledgeSignal(env.DB, id, acknowledgement, new Date().toISOString());

  if (!result.found) {
    return errorResponse(404, 'SIGNAL_NOT_FOUND', 'La señal no existe.');
  }
  if (result.leaseMismatch) {
    return errorResponse(409, 'LEASE_MISMATCH', 'La reserva de esta señal pertenece a otro consumidor.');
  }

  return jsonResponse({
    ok: true,
    id,
    status: result.status,
    alreadyAcknowledged: result.alreadyAcknowledged,
    nextAttemptAt: result.nextAttemptAt
  });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/webhooks/tradingview/vix') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return handleVixWebhook(request, env);
  }

  if (path === '/webhooks/tradingview/market') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return handleMarketObservationWebhook(request, env);
  }

  if (path === '/webhooks/tradingview') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return handleWebhook(request, env);
  }

  if (path === '/api/v1/health') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return handleHealth(request, env);
  }

  if (path === '/api/v1/signals/claim') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return handleClaim(request, env);
  }

  if (path === '/api/v1/context/vix') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return handleVixContext(request, env, url);
  }

  if (path === '/api/v1/market-observations') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return handleMarketObservations(request, env, url);
  }

  const ackMatch = path.match(/^\/api\/v1\/signals\/([^/]+)\/ack$/);
  if (ackMatch) {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return handleAck(request, env, decodeURIComponent(ackMatch[1]));
  }

  return errorResponse(404, 'NOT_FOUND', 'Ruta no encontrada.');
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof RequestError) {
        return errorResponse(error.status, error.code, error.message, error.field);
      }
      return errorResponse(500, 'INTERNAL_ERROR', 'No fue posible procesar la solicitud.');
    }
  },
  async scheduled(_controller, env, context) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    const vixCutoff = new Date();
    vixCutoff.setUTCFullYear(vixCutoff.getUTCFullYear() - 25);
    context.waitUntil(Promise.all([
      purgeTerminalSignals(env.DB, cutoff),
      purgeVixHistory(env.DB, vixCutoff.toISOString().slice(0, 10)),
      purgeMarketObservations(env.DB, cutoff)
    ]));
  }
};

export { route };
