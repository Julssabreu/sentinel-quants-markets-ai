'use strict';
/**
 * Métricas de sesión deterministas: VWAP y opening range.
 *
 * Vive en `shared/` porque tanto el proceso principal (informe diario programado)
 * como el renderer (Centro de Inteligencia, vía sessionMetricsFetch.ts) necesitan la
 * misma aritmética. Duplicarla habría creado el mismo par divergente que esta
 * auditoría lleva todo el día señalando en otros módulos.
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

const SESSION_METRICS_VERSION = '1.0.0';

const typicalPrice = bar => (bar.high + bar.low + bar.close) / 3;

const usable = bar =>
  [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) && Number.isFinite(Date.parse(bar.time));

/**
 * Elige la base de volumen. Solo usa `realVolume` si TODAS las velas lo aportan con
 * valor positivo; una serie mixta produciría un VWAP incomparable entre barras.
 */
function resolveVolumeBasis(candles) {
  if (!candles.length) return null;
  if (candles.every(bar => Number.isFinite(bar.realVolume) && bar.realVolume > 0)) return 'REAL_VOLUME';
  if (candles.some(bar => Number.isFinite(bar.tickVolume) && bar.tickVolume > 0)) return 'TICK_VOLUME';
  return null;
}

const volumeOf = (bar, basis) =>
  Math.max(0, Number(basis === 'REAL_VOLUME' ? bar.realVolume : bar.tickVolume) || 0);

/**
 * VWAP acumulado desde `anchorTime` inclusive. Sin ancla usa todas las velas dadas.
 * El llamador decide el ancla porque solo él conoce la apertura del mercado.
 */
function calculateVwap(candles, options = {}) {
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
  const last = window[window.length - 1];
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
function calculateOpeningRange(candles, options) {
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
  const last = valid[valid.length - 1];
  const position = last.close > high ? 'ABOVE' : last.close < low ? 'BELOW' : 'INSIDE';
  // Solo cuentan las velas posteriores a la ventana: una ruptura dentro del propio
  // rango de apertura no es una ruptura.
  const after = valid.filter(bar => Date.parse(bar.time) >= endMs);
  const breakoutBar = after.find(bar => bar.close > high || bar.close < low);
  return {
    ok: true,
    data: {
      high, low, mid: (high + low) / 2, width: high - low,
      bars: window.length, openTime: window[0].time, closeTime: window[window.length - 1].time,
      position,
      breakout: breakoutBar ? (breakoutBar.close > high ? 'ABOVE' : 'BELOW') : null,
    },
  };
}

module.exports = {
  SESSION_METRICS_VERSION,
  resolveVolumeBasis,
  calculateVwap,
  calculateOpeningRange,
};
