/**
 * Orquesta VWAP y opening range para la acción en foco a partir de velas MT5.
 *
 * Esta lógica también existe en `shared/stockSessionMetricsFetch.cjs`, usada por el
 * informe diario en `electron/main.cjs`. NO se comparte un solo archivo a propósito:
 * este módulo se ejecuta en el navegador (parte del bundle del renderer, alcanzable
 * desde `useDailyIntelligence.ts`), y Vite no logra interoperar de forma fiable con
 * exportaciones nombradas de un `.cjs` cuando ese archivo llega al bundle del
 * navegador — se comprobó en vivo: `SyntaxError: the requested module ... does not
 * provide an export named 'OPENING_RANGE_MINUTES'` al intentar importar el `.cjs`
 * compartido desde aquí. El resto del día, `shared/*.cjs` se compartió sin problema
 * porque solo lo consumían `electron/main.cjs` (Node real) y los tests de Vitest
 * (Node vía vite-node) — nunca el bundle que corre en el navegador.
 *
 * Si tocas la ventana de sesión, el ORB o la elección de base de volumen, cambia
 * TAMBIÉN `shared/stockSessionMetricsFetch.cjs` — están sincronizadas por disciplina,
 * no por importación.
 */
import { getMarketSessionContext } from './marketSessionContext';
import { calculateOpeningRange, calculateVwap, type VolumeBasis as CalcVolumeBasis } from './sessionMetricsCalc';
import type { SessionMetricsSnapshot } from './dailyIntelligence';

/**
 * Ventana del opening range. 15 minutos (ORB15) es la convención más citada; se aísla
 * aquí para que cambiarla no obligue a tocar la orquestación.
 */
export const OPENING_RANGE_MINUTES = 15;

type Mt5RatesFetcher = (symbol: string, timeframe: string, count: number) => Promise<Mt5RatesResponse>;

/**
 * Construye el ancla y la ventana de velas para "hoy" a partir del contexto de sesión.
 * Solo durante REGULAR el ancla es inequívoca: fuera de esa franja no hay una apertura
 * de hoy que reconstruir sin repetir las reglas de DST que ya asume marketSessionContext.
 */
export async function buildStockSessionMetrics(
  fetchRates: Mt5RatesFetcher,
  ticker: string,
  now: Date,
): Promise<SessionMetricsSnapshot> {
  const context = getMarketSessionContext('STOCK', now);
  if (context.session !== 'REGULAR' || context.minutesFromSessionOpen == null || context.minutesFromSessionOpen < 0) {
    return {
      vwap: null, openingRange: null,
      unavailableReason: 'VWAP y opening range solo se calculan durante la sesión regular de EE. UU.',
    };
  }

  const minutesSinceOpen = context.minutesFromSessionOpen;
  const anchorTime = new Date(now.getTime() - minutesSinceOpen * 60_000).toISOString();
  // +5 de margen para no perder la vela de apertura por redondeo de minuto.
  const count = Math.min(600, minutesSinceOpen + 5);

  let rates: Mt5RatesResponse;
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
    vwap: vwap.ok ? { value: vwap.data.value, basis: vwap.data.basis as CalcVolumeBasis, anchorTime: vwap.data.anchorTime } : null,
    openingRange: openingRange.ok
      ? { high: openingRange.data.high, low: openingRange.data.low, breakout: openingRange.data.breakout }
      : null,
    unavailableReason,
  };
}
