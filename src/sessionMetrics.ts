/**
 * Métricas de sesión deterministas: VWAP y opening range.
 *
 * Ambas son aritmética sobre velas ya cerradas. No intervienen modelos ni IA: si un
 * LLM "calculara" un VWAP produciría un número plausible y equivocado.
 *
 * Sobre el volumen: MT5 entrega `realVolume` (volumen negociado) y `tickVolume`
 * (número de cambios de precio). En CFDs y divisas el bróker suele reportar
 * `realVolume: 0` porque no existe volumen centralizado. Un VWAP sobre `tickVolume`
 * es un proxy, no el VWAP institucional, y este módulo lo declara siempre en
 * `basis` en lugar de disimularlo.
 */

import type { Candle } from './analysisEngine';

export const SESSION_METRICS_VERSION = '1.0.0' as const;

export type VolumeBasis = 'REAL_VOLUME' | 'TICK_VOLUME';

export type SessionMetricFailure =
  | 'NO_CANDLES'
  | 'NO_VOLUME'
  | 'NO_BARS_IN_WINDOW'
  | 'INVALID_WINDOW';

export type SessionMetric<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SessionMetricFailure; detail: string };

export interface VwapResult {
  value: number;
  /** Declara si el VWAP es real o un proxy por volumen de ticks. */
  basis: VolumeBasis;
  bars: number;
  cumulativeVolume: number;
  anchorTime: string;
  lastTime: string;
  /** Distancia del último cierre al VWAP, en precio. */
  closeDistance: number;
}

export interface OpeningRangeResult {
  high: number;
  low: number;
  mid: number;
  width: number;
  bars: number;
  openTime: string;
  closeTime: string;
  /** Posición del último cierre conocido respecto al rango. */
  position: 'ABOVE' | 'INSIDE' | 'BELOW';
  /** Ruptura confirmada por cierre, no por mecha. */
  breakout: 'ABOVE' | 'BELOW' | null;
}

const typicalPrice = (bar: Candle) => (bar.high + bar.low + bar.close) / 3;

const usable = (bar: Candle) =>
  [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) && Number.isFinite(Date.parse(bar.time));

/**
 * Elige la base de volumen. Solo usa `realVolume` si TODAS las velas lo aportan con
 * valor positivo; una serie mixta produciría un VWAP incomparable entre barras.
 */
export function resolveVolumeBasis(candles: readonly Candle[]): VolumeBasis | null {
  if (!candles.length) return null;
  if (candles.every(bar => Number.isFinite(bar.realVolume) && (bar.realVolume as number) > 0)) return 'REAL_VOLUME';
  if (candles.some(bar => Number.isFinite(bar.tickVolume) && (bar.tickVolume as number) > 0)) return 'TICK_VOLUME';
  return null;
}

const volumeOf = (bar: Candle, basis: VolumeBasis) =>
  Math.max(0, Number(basis === 'REAL_VOLUME' ? bar.realVolume : bar.tickVolume) || 0);

/**
 * VWAP acumulado desde `anchorTime` inclusive. Sin ancla usa todas las velas dadas.
 * El llamador decide el ancla porque solo él conoce la apertura del mercado.
 */
export function calculateVwap(
  candles: readonly Candle[],
  options: { anchorTime?: string } = {},
): SessionMetric<VwapResult> {
  const valid = candles.filter(usable).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!valid.length) return { ok: false, reason: 'NO_CANDLES', detail: 'No hay velas utilizables.' };

  let window = valid;
  if (options.anchorTime) {
    const anchorMs = Date.parse(options.anchorTime);
    if (!Number.isFinite(anchorMs))
      return { ok: false, reason: 'INVALID_WINDOW', detail: `Ancla inválida: ${options.anchorTime}` };
    window = valid.filter(bar => Date.parse(bar.time) >= anchorMs);
    if (!window.length)
      return { ok: false, reason: 'NO_BARS_IN_WINDOW', detail: `Ninguna vela en o después de ${options.anchorTime}.` };
  }

  const basis = resolveVolumeBasis(window);
  if (!basis)
    return { ok: false, reason: 'NO_VOLUME', detail: 'Las velas no traen volumen real ni de ticks; el VWAP no es calculable.' };

  let weighted = 0, total = 0;
  for (const bar of window) {
    const volume = volumeOf(bar, basis);
    weighted += typicalPrice(bar) * volume;
    total += volume;
  }
  if (total <= 0)
    return { ok: false, reason: 'NO_VOLUME', detail: 'El volumen acumulado es cero; el VWAP no es calculable.' };

  const value = weighted / total;
  const last = window.at(-1)!;
  return {
    ok: true,
    data: {
      value, basis, bars: window.length, cumulativeVolume: total,
      anchorTime: window[0].time, lastTime: last.time,
      closeDistance: last.close - value,
    },
  };
}

/**
 * Opening range: máximo y mínimo de los primeros `minutes` desde `openTime`.
 * La ruptura se confirma por cierre fuera del rango, nunca por mecha.
 */
export function calculateOpeningRange(
  candles: readonly Candle[],
  options: { openTime: string; minutes: number },
): SessionMetric<OpeningRangeResult> {
  const openMs = Date.parse(options.openTime);
  if (!Number.isFinite(openMs))
    return { ok: false, reason: 'INVALID_WINDOW', detail: `Apertura inválida: ${options.openTime}` };
  if (!Number.isFinite(options.minutes) || options.minutes <= 0)
    return { ok: false, reason: 'INVALID_WINDOW', detail: 'La ventana debe ser un número positivo de minutos.' };

  const valid = candles.filter(usable).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!valid.length) return { ok: false, reason: 'NO_CANDLES', detail: 'No hay velas utilizables.' };

  const endMs = openMs + options.minutes * 60_000;
  const window = valid.filter(bar => {
    const ms = Date.parse(bar.time);
    return ms >= openMs && ms < endMs;
  });
  if (!window.length)
    return {
      ok: false, reason: 'NO_BARS_IN_WINDOW',
      detail: `Ninguna vela entre ${options.openTime} y +${options.minutes} min.`,
    };

  const high = Math.max(...window.map(bar => bar.high));
  const low = Math.min(...window.map(bar => bar.low));
  const last = valid.at(-1)!;
  const position: OpeningRangeResult['position'] = last.close > high ? 'ABOVE' : last.close < low ? 'BELOW' : 'INSIDE';
  // Solo cuentan las velas posteriores a la ventana: una ruptura dentro del propio
  // rango de apertura no es una ruptura.
  const after = valid.filter(bar => Date.parse(bar.time) >= endMs);
  const breakoutBar = after.find(bar => bar.close > high || bar.close < low);
  return {
    ok: true,
    data: {
      high, low, mid: (high + low) / 2, width: high - low,
      bars: window.length, openTime: window[0].time, closeTime: window.at(-1)!.time,
      position,
      breakout: breakoutBar ? (breakoutBar.close > high ? 'ABOVE' : 'BELOW') : null,
    },
  };
}
