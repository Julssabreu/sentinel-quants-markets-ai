'use strict';
/**
 * Niveles técnicos deterministas para el plan por acción del informe diario.
 *
 * Todo aquí es aritmética sobre velas ya cerradas: medias móviles, ATR de Wilder,
 * pivotes clásicos, RSI y el plan de entrada/stop/objetivos. No interviene ningún
 * modelo ni IA — si un LLM "calculara" un ATR produciría un número plausible y
 * equivocado, y estos valores se usan para decidir dónde poner un stop.
 *
 * Las fórmulas siguen las convenciones estándar y están declaradas en cada función
 * para que se puedan auditar contra cualquier plataforma.
 */

const TECHNICAL_LEVELS_VERSION = '1.0.0';

const isBar = bar => bar
  && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)
  && bar.h >= bar.l;

/** Media móvil simple de los últimos `period` cierres. */
function simpleMovingAverage(closes, period) {
  const values = (closes ?? []).filter(Number.isFinite);
  if (values.length < period || period <= 0) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

/** Rango verdadero de una vela respecto al cierre anterior. */
function trueRange(bar, previousClose) {
  if (!isBar(bar)) return null;
  if (!Number.isFinite(previousClose)) return bar.h - bar.l;
  return Math.max(bar.h - bar.l, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose));
}

/**
 * ATR con suavizado de Wilder, no media simple: el primer valor es el promedio de los
 * primeros `period` rangos verdaderos y a partir de ahí
 * ATR_t = (ATR_previo × (period − 1) + TR_t) / period.
 * Una media simple daría un número distinto y no coincidiría con las plataformas.
 */
function averageTrueRange(bars, period = 14) {
  const valid = (bars ?? []).filter(isBar);
  if (valid.length < period + 1 || period <= 0) return null;

  const ranges = [];
  for (let index = 1; index < valid.length; index++)
    ranges.push(trueRange(valid[index], valid[index - 1].c));

  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index++)
    atr = (atr * (period - 1) + ranges[index]) / period;
  return atr;
}

/**
 * Pivotes clásicos sobre el máximo, mínimo y cierre de la sesión anterior.
 *   P  = (H + L + C) / 3
 *   R1 = 2P − L      S1 = 2P − H
 *   R2 = P + (H − L) S2 = P − (H − L)
 *   R3 = H + 2(P − L) S3 = L − 2(H − P)
 */
function classicPivots(high, low, close) {
  if (![high, low, close].every(Number.isFinite) || high < low) return null;
  const p = (high + low + close) / 3;
  const range = high - low;
  return {
    p,
    r1: 2 * p - low, s1: 2 * p - high,
    r2: p + range, s2: p - range,
    r3: high + 2 * (p - low), s3: low - 2 * (high - p),
  };
}

/** RSI con suavizado de Wilder sobre los cierres. */
function relativeStrengthIndex(closes, period = 14) {
  const values = (closes ?? []).filter(Number.isFinite);
  if (values.length < period + 1 || period <= 0) return null;

  const gains = [], losses = [];
  for (let index = 1; index < values.length; index++) {
    const delta = values[index] - values[index - 1];
    gains.push(Math.max(0, delta));
    losses.push(Math.max(0, -delta));
  }
  let avgGain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < gains.length; index++) {
    avgGain = (avgGain * (period - 1) + gains[index]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[index]) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Máximo y mínimo del periodo cubierto por las velas diarias entregadas. */
function periodRange(bars) {
  const valid = (bars ?? []).filter(isBar);
  if (!valid.length) return null;
  return {
    high: Math.max(...valid.map(bar => bar.h)),
    low: Math.min(...valid.map(bar => bar.l)),
    bars: valid.length,
  };
}

/**
 * Porcentaje del ATR diario ya consumido por el rango recorrido en la sesión.
 * Por encima del 100 % el valor ya hizo el recorrido de un día entero: cualquier
 * extensión adicional exige un día de tendencia excepcional.
 */
function rangeBudget(sessionHigh, sessionLow, atr) {
  if (![sessionHigh, sessionLow, atr].every(Number.isFinite) || atr <= 0 || sessionHigh < sessionLow) return null;
  const consumed = sessionHigh - sessionLow;
  return { consumedPercent: (consumed / atr) * 100, consumed, atr, remaining: Math.max(0, atr - consumed) };
}

/**
 * Plan de operación sobre niveles reales.
 *
 * Entrada: la primera resistencia por encima del precio, nunca "a mercado" — si el
 * nivel no se rompe con volumen, no hay operación.
 * Stop: max(stopAtrMultiple × ATR ; stopMinPercent % de la entrada). El suelo
 * porcentual evita un stop absurdamente estrecho en valores de ATR muy bajo.
 * Objetivos: entrada + 1,5R y + 2,5R. Por debajo de 1,5:1 en intradía no compensa.
 *
 * Devuelve null si no hay una resistencia válida por encima del precio: preferimos no
 * dar plan antes que inventar un nivel.
 */
function buildLevelPlan(input) {
  const { price, resistances, atr } = input;
  const stopAtrMultiple = input.stopAtrMultiple ?? 0.4;
  const stopMinPercent = input.stopMinPercent ?? 0.8;
  const minimumRR = input.minimumRR ?? 1.5;
  if (![price, atr].every(Number.isFinite) || price <= 0 || atr <= 0) return null;

  const entry = (resistances ?? [])
    .filter(level => Number.isFinite(level) && level > price)
    .sort((a, b) => a - b)[0];
  if (!Number.isFinite(entry)) return null;

  const riskPerShare = Math.max(stopAtrMultiple * atr, (stopMinPercent / 100) * entry);
  const stop = entry - riskPerShare;
  if (!(riskPerShare > 0) || stop <= 0) return null;

  return {
    entry, stop, riskPerShare,
    riskPercent: (riskPerShare / entry) * 100,
    target1: entry + 1.5 * riskPerShare,
    target2: entry + 2.5 * riskPerShare,
    minimumRR,
    distanceToEntryPercent: ((entry - price) / price) * 100,
  };
}

/** Acciones para arriesgar `riskAmount` con el riesgo por acción del plan. */
function positionSize(riskAmount, riskPerShare) {
  if (![riskAmount, riskPerShare].every(Number.isFinite) || riskPerShare <= 0 || riskAmount <= 0) return null;
  const shares = Math.floor(riskAmount / riskPerShare);
  return shares > 0 ? shares : null;
}

/**
 * Convicción declarada a partir de señales medibles, no de una opinión.
 * Cada penalización cita el dato que la produce para que sea auditable.
 */
function assessConviction(input) {
  const warnings = [];
  if (Number.isFinite(input.rangeBudgetPercent) && input.rangeBudgetPercent >= 100)
    warnings.push(`ya consumió el ${input.rangeBudgetPercent.toFixed(0)} % de su ATR diario`);
  if (Number.isFinite(input.rsi) && input.rsi >= 70) warnings.push(`RSI en sobrecompra (${input.rsi.toFixed(0)})`);
  if (Number.isFinite(input.rsi) && input.rsi <= 30) warnings.push(`RSI en sobreventa (${input.rsi.toFixed(0)})`);
  if (Number.isFinite(input.volumeRatio) && input.volumeRatio < 1)
    warnings.push(`volumen por debajo de su ritmo normal (${input.volumeRatio.toFixed(1)}x)`);
  if (input.belowLongTermTrend === true) warnings.push('cotiza por debajo de su media de 200 sesiones');

  const level = warnings.length === 0 ? 'ALTA' : warnings.length <= 2 ? 'MEDIA' : 'BAJA';
  return { level, warnings };
}

module.exports = {
  TECHNICAL_LEVELS_VERSION,
  simpleMovingAverage, trueRange, averageTrueRange, classicPivots,
  relativeStrengthIndex, periodRange, rangeBudget,
  buildLevelPlan, positionSize, assessConviction,
};
