'use strict';
/**
 * Orquesta VWAP y opening range para una acción a partir de velas MT5.
 *
 * Vive en `shared/` porque tanto el proceso principal (informe diario programado)
 * como el renderer (Centro de Inteligencia) necesitan la misma ventana de sesión y
 * la misma aritmética — duplicarla sería el mismo par divergente que esta auditoría
 * lleva todo el día señalando.
 *
 * `fetchRates` es cualquier función `(symbol, timeframe, count) => Promise<{ok, candles, error}>`:
 * en el renderer es `window.sentinel.getMt5Rates` (IPC); en el proceso principal es un
 * envoltorio directo sobre `runMt5Bridge('rates', ...)`. Misma forma, transportes distintos.
 */

const { calculateVwap, calculateOpeningRange } = require('./sessionMetrics.cjs');

/** Ventana del opening range. 15 minutos (ORB15) es la convención más citada. */
const OPENING_RANGE_MINUTES = 15;

/**
 * Sesión REGULAR de acciones en EE. UU., en minutos UTC desde medianoche.
 * Espeja los mismos límites que src/marketSessionContext.ts usa para STOCK
 * (810 = 13:30 UTC, 1200 = 20:00 UTC). Se reduce aquí a solo esa franja porque el
 * informe diario únicamente necesita saber "cuánto lleva abierta la sesión regular
 * de hoy", no las doce clases de mercado que maneja el módulo completo del renderer.
 */
function usStockRegularSessionMinutesSinceOpen(now) {
  const dayOfWeek = now.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minute < 810 || minute >= 1200) return null;
  return minute - 810;
}

/**
 * Construye el ancla y la ventana de velas para "hoy". Solo durante REGULAR el ancla
 * es inequívoca: fuera de esa franja no hay una apertura de hoy que reconstruir.
 */
async function buildStockSessionMetrics(fetchRates, ticker, now) {
  const minutesSinceOpen = usStockRegularSessionMinutesSinceOpen(now);
  if (minutesSinceOpen == null) {
    return {
      vwap: null, openingRange: null,
      unavailableReason: 'VWAP y opening range solo se calculan durante la sesión regular de EE. UU.',
    };
  }

  const anchorTime = new Date(now.getTime() - minutesSinceOpen * 60_000).toISOString();
  // +5 de margen para no perder la vela de apertura por redondeo de minuto.
  const count = Math.min(600, minutesSinceOpen + 5);

  let rates;
  try {
    rates = await fetchRates(ticker, 'M1', count);
  } catch (cause) {
    return { vwap: null, openingRange: null, unavailableReason: `MT5: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!rates.ok || !rates.candles?.length)
    return { vwap: null, openingRange: null, unavailableReason: rates.error ? `MT5: ${rates.error}` : 'MT5 no entregó velas M1 para hoy.' };

  const vwap = calculateVwap(rates.candles, { anchorTime });
  const openingRange = calculateOpeningRange(rates.candles, { openTime: anchorTime, minutes: OPENING_RANGE_MINUTES });
  const unavailableReason = vwap.ok || openingRange.ok
    ? null
    : !vwap.ok && vwap.reason === 'NO_VOLUME'
      ? 'MT5 no reporta volumen para este símbolo.'
      : 'Datos insuficientes para VWAP u opening range en lo que va de la sesión.';

  return {
    vwap: vwap.ok ? { value: vwap.data.value, basis: vwap.data.basis, anchorTime: vwap.data.anchorTime } : null,
    openingRange: openingRange.ok
      ? { high: openingRange.data.high, low: openingRange.data.low, breakout: openingRange.data.breakout }
      : null,
    unavailableReason,
  };
}

module.exports = { OPENING_RANGE_MINUTES, usStockRegularSessionMinutesSinceOpen, buildStockSessionMetrics };
