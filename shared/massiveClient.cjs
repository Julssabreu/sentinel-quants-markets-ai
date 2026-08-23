'use strict';
/**
 * Cliente de solo lectura para Massive (antes Polygon.io) — datos de acciones de
 * EE. UU. con horario extendido.
 *
 * Resuelve el hueco que MT5 no puede cubrir: el feed del bróker es de CFDs y solo
 * entrega sesión regular. Verificado en vivo el 2026-08-23 con el plan gratuito:
 * AAPL del 2026-08-21 devolvió 252 barras de premercado (04:00–09:29 ET), 390 de
 * sesión regular y 164 de after-hours (16:00–19:59 ET).
 *
 * Notas del plan gratuito:
 *   - 5 llamadas por minuto. El espaciado por defecto lo respeta.
 *   - Datos con 15 minutos de retraso, irrelevante para un informe de las 9:00 que
 *     resume lo que ya ocurrió.
 *
 * Las fronteras de sesión se calculan contra la zona horaria real de Nueva York, no
 * con un offset fijo: en invierno ET es UTC-5 y en verano UTC-4, y dar por buena una
 * sola de las dos desplazaría la ventana una hora media parte del año.
 */

const MASSIVE_CLIENT_VERSION = '1.0.0';
const MASSIVE_BASE_URL = 'https://api.massive.com';

/** Plan gratuito: 5 llamadas por minuto. 12,5 s deja margen. */
const DEFAULT_MIN_INTERVAL_MS = 12_500;

/** Fronteras de la sesión bursátil de EE. UU., en hora de Nueva York. */
const SESSION_BOUNDARIES = Object.freeze({
  premarketOpen: { hour: 4, minute: 0 },
  regularOpen: { hour: 9, minute: 30 },
  regularClose: { hour: 16, minute: 0 },
  afterHoursClose: { hour: 20, minute: 0 },
});

/** Desfase de una zona horaria respecto a UTC, en ms, para un instante dado. */
function timeZoneOffsetMs(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map(part => [part.type, part.value])
  );
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return asIfUtc - utcMs;
}

/**
 * Instante UTC correspondiente a una hora local de Nueva York en una fecha dada.
 * Se corrige dos veces porque el desfase puede cambiar justo en el salto de horario.
 */
function newYorkTimeToUtcMs(dateIso, hour, minute) {
  const naive = Date.parse(`${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  if (!Number.isFinite(naive)) throw new Error(`Fecha inválida: ${dateIso}`);
  let utc = naive - timeZoneOffsetMs(naive, 'America/New_York');
  utc = naive - timeZoneOffsetMs(utc, 'America/New_York');
  return utc;
}

/** Fronteras en ms UTC de las tres ventanas de una fecha bursátil. */
function sessionWindowsForDate(dateIso) {
  return {
    premarketOpen: newYorkTimeToUtcMs(dateIso, SESSION_BOUNDARIES.premarketOpen.hour, SESSION_BOUNDARIES.premarketOpen.minute),
    regularOpen: newYorkTimeToUtcMs(dateIso, SESSION_BOUNDARIES.regularOpen.hour, SESSION_BOUNDARIES.regularOpen.minute),
    regularClose: newYorkTimeToUtcMs(dateIso, SESSION_BOUNDARIES.regularClose.hour, SESSION_BOUNDARIES.regularClose.minute),
    afterHoursClose: newYorkTimeToUtcMs(dateIso, SESSION_BOUNDARIES.afterHoursClose.hour, SESSION_BOUNDARIES.afterHoursClose.minute),
  };
}

/** Fecha bursátil (YYYY-MM-DD en hora de Nueva York) para un instante dado. */
function newYorkDateIso(utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' })
      .formatToParts(new Date(utcMs)).map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Día de la semana en Nueva York: 0 domingo … 6 sábado. */
function newYorkDayOfWeek(dateIso) {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

/**
 * Las dos últimas fechas bursátiles relevantes para el informe: la sesión "actual"
 * (cuyo premercado se lee) y la "anterior" (cuyo cierre regular y after-hours se leen).
 *
 * Un lunes, la sesión anterior es el viernes, no un domingo que nunca existió. Sábado
 * y domingo se tratan como si la sesión actual fuera el viernes. No contempla feriados
 * de mercado: Sentinel no tiene un calendario de feriados conectado, así que en un
 * feriado el informe encontrará simplemente cero barras y lo declarará.
 */
function lastTwoSessionDates(now) {
  const stepBack = (dateIso, days) => {
    const date = new Date(`${dateIso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const previousWeekday = dateIso => {
    let cursor = dateIso;
    do { cursor = stepBack(cursor, 1); } while (newYorkDayOfWeek(cursor) === 0 || newYorkDayOfWeek(cursor) === 6);
    return cursor;
  };
  let currentSessionDate = newYorkDateIso(now.getTime());
  const day = newYorkDayOfWeek(currentSessionDate);
  if (day === 0 || day === 6) currentSessionDate = previousWeekday(currentSessionDate);
  return { currentSessionDate, previousSessionDate: previousWeekday(currentSessionDate) };
}

/** Clasifica barras en premercado, sesión regular y after-hours de una fecha. */
function splitSessions(bars, dateIso) {
  const w = sessionWindowsForDate(dateIso);
  const inRange = (bar, from, to) => bar.t >= from && bar.t < to;
  return {
    premarket: bars.filter(bar => inRange(bar, w.premarketOpen, w.regularOpen)),
    regular: bars.filter(bar => inRange(bar, w.regularOpen, w.regularClose)),
    afterHours: bars.filter(bar => inRange(bar, w.regularClose, w.afterHoursClose)),
  };
}

/** Resumen de una ventana: null si no hay barras, nunca un cero inventado. */
function summarizeWindow(bars, referenceClose) {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const highs = bars.map(bar => bar.h), lows = bars.map(bar => bar.l);
  const volume = bars.reduce((sum, bar) => sum + (Number(bar.v) || 0), 0);
  const changePercent = Number.isFinite(referenceClose) && referenceClose > 0
    ? ((last.c - referenceClose) / referenceClose) * 100
    : null;
  return {
    last: last.c,
    high: Math.max(...highs),
    low: Math.min(...lows),
    volume,
    bars: bars.length,
    changePercent,
    firstBarAt: new Date(bars[0].t).toISOString(),
    lastBarAt: new Date(last.t).toISOString(),
  };
}

function createMassiveClient(config = {}) {
  const apiKey = String(config.apiKey ?? '').trim();
  if (!apiKey) throw new Error('Massive requiere una clave de API; configúrala antes de consultar.');

  const doFetch = config.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('No hay implementación de fetch disponible para Massive.');

  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const baseUrl = config.baseUrl ?? MASSIVE_BASE_URL;

  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let queue = Promise.resolve();

  /** Serializa y espacia las llamadas para respetar el límite del plan gratuito. */
  function throttled(task) {
    const run = queue.then(async () => {
      const waitMs = lastRequestAt + minIntervalMs - now();
      if (waitMs > 0) await sleep(waitMs);
      lastRequestAt = now();
      return task();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function getJson(url) {
    try {
      const response = await throttled(() => doFetch(url, { headers: { Authorization: `Bearer ${apiKey}` } }));
      if (response.status === 429)
        return { ok: false, reason: 'RATE_LIMITED', detail: 'Massive rechazó por límite de llamadas del plan.', source: url };
      if (!response.ok)
        return { ok: false, reason: 'HTTP_ERROR', detail: `HTTP ${response.status}`, source: url };
      try {
        return { ok: true, data: await response.json(), retrievedAt: new Date(now()).toISOString(), source: url };
      } catch (error) {
        return { ok: false, reason: 'MALFORMED_RESPONSE', detail: String(error), source: url };
      }
    } catch (error) {
      return { ok: false, reason: 'NETWORK_ERROR', detail: String(error), source: url };
    }
  }

  /** Barras de un minuto entre dos fechas, incluyendo horario extendido. */
  async function minuteBars(ticker, fromDateIso, toDateIso) {
    const symbol = String(ticker ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(symbol))
      return { ok: false, reason: 'INVALID_TICKER', detail: `Ticker inválido: ${ticker}`, source: baseUrl };
    const url = `${baseUrl}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${fromDateIso}/${toDateIso}?adjusted=true&sort=asc&limit=50000`;
    const response = await getJson(url);
    if (!response.ok) return response;
    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    return { ok: true, data: results, retrievedAt: response.retrievedAt, source: url };
  }

  /**
   * Instantánea de horario extendido para el informe: after-hours y cierre regular de
   * la sesión anterior, más el premercado de la sesión actual. Una sola llamada.
   */
  async function extendedHoursSnapshot(ticker, previousSessionDateIso, currentSessionDateIso) {
    const response = await minuteBars(ticker, previousSessionDateIso, currentSessionDateIso);
    if (!response.ok) return { ticker, error: response.detail, reason: response.reason, previousClose: null, afterHours: null, premarket: null };

    const previous = splitSessions(response.data, previousSessionDateIso);
    const current = splitSessions(response.data, currentSessionDateIso);
    const previousClose = previous.regular.length ? previous.regular[previous.regular.length - 1].c : null;

    return {
      ticker: String(ticker).toUpperCase(),
      previousSessionDate: previousSessionDateIso,
      currentSessionDate: currentSessionDateIso,
      previousClose,
      afterHours: summarizeWindow(previous.afterHours, previousClose),
      premarket: summarizeWindow(current.premarket, previousClose),
      retrievedAt: response.retrievedAt,
      error: null,
      reason: null,
    };
  }

  return { version: MASSIVE_CLIENT_VERSION, minuteBars, extendedHoursSnapshot };
}

module.exports = {
  MASSIVE_CLIENT_VERSION,
  MASSIVE_BASE_URL,
  SESSION_BOUNDARIES,
  newYorkTimeToUtcMs,
  newYorkDateIso,
  lastTwoSessionDates,
  sessionWindowsForDate,
  splitSessions,
  summarizeWindow,
  createMassiveClient,
};
