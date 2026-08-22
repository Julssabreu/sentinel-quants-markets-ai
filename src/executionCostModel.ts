import type { Candle } from './analysisEngine';

export interface ExecutionCostProfile {
  id: string;
  spreadPrice: number;
  slippagePrice: number;
  commissionRoundTripPrice: number;
  latencyMs: number;
  conservativeSameBar: boolean;
}

export interface ExecutedTradePlan {
  direction: 'LONG' | 'SHORT';
  requestedEntry: number;
  entryFill: number;
  stop: number;
  target: number;
  riskPrice: number;
  /** Ratio calculado sobre `entryFill`, no sobre el precio de la señal. */
  realizedRR: number;
  estimatedRoundTripCostPrice: number;
  estimatedCostR: number;
}

export const ZERO_COST_EXECUTION: ExecutionCostProfile = Object.freeze({
  id:'ZERO_COST_RESEARCH_ONLY', spreadPrice:0, slippagePrice:0,
  commissionRoundTripPrice:0, latencyMs:0, conservativeSameBar:true,
});

function nonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} debe ser finito y no negativo.`);
  return value;
}

export function prepareExecutedTrade(
  direction: 'LONG' | 'SHORT',
  entry: number,
  stop: number,
  target: number,
  profile: ExecutionCostProfile,
  /** Ratio mínimo exigido, revalidado contra el precio de llenado real. */
  minimumRR?: number,
): ExecutedTradePlan {
  const halfSpread = nonNegative(profile.spreadPrice, 'spreadPrice') / 2;
  const slippage = nonNegative(profile.slippagePrice, 'slippagePrice');
  const commission = nonNegative(profile.commissionRoundTripPrice, 'commissionRoundTripPrice');
  const side = direction === 'LONG' ? 1 : -1;
  const entryFill = entry + side * (halfSpread + slippage);
  const riskPrice = Math.abs(entryFill - stop);
  if (![entry, stop, target, entryFill].every(Number.isFinite) || riskPrice <= 0)
    throw new Error('Plan de ejecución inválido: entrada, stop y target deben formar un riesgo positivo.');
  // El plan se valida aquí, donde se ejecuta, y no solo donde se calculó: un stop u
  // objetivo del lado equivocado produce operaciones que se cierran a ~0R y contaminan
  // las ablaciones en lugar de ser rechazadas.
  const stopBeyondEntry = direction === 'LONG' ? stop < entryFill : stop > entryFill;
  const targetBeyondEntry = direction === 'LONG' ? target > entryFill : target < entryFill;
  if (!stopBeyondEntry)
    throw new Error(`Plan de ejecución inválido: en ${direction} el stop debe quedar ${direction === 'LONG' ? 'por debajo' : 'por encima'} de la entrada.`);
  if (!targetBeyondEntry)
    throw new Error(`Plan de ejecución inválido: en ${direction} el objetivo debe quedar ${direction === 'LONG' ? 'por encima' : 'por debajo'} de la entrada.`);
  // El ratio se recalcula sobre el precio de llenado, no sobre el cierre de la señal.
  // La estrategia admite un plan mirando el cierre M5, pero la entrada real ocurre en la
  // apertura siguiente: con un hueco, un plan aceptado como 1.5R puede ejecutarse a 0.9R.
  const reward = direction === 'LONG' ? target - entryFill : entryFill - target;
  const realizedRR = reward / riskPrice;
  if (minimumRR != null && Number.isFinite(minimumRR) && realizedRR < minimumRR)
    throw new Error(`Plan de ejecución inválido: en el precio real de entrada el ratio es ${realizedRR.toFixed(2)}R y el mínimo exigido es ${minimumRR}R.`);
  const estimatedRoundTripCostPrice = profile.spreadPrice + profile.slippagePrice * 2 + commission;
  return {
    direction, requestedEntry:entry, entryFill, stop, target, riskPrice, realizedRR,
    estimatedRoundTripCostPrice,
    estimatedCostR:estimatedRoundTripCostPrice / riskPrice,
  };
}

export type ExitReason = 'STOP' | 'TARGET' | 'END_OF_DATA';

export interface TradeExit {
  reason: ExitReason;
  exitFill: number;
  grossResultR: number;
  netResultR: number;
  /**
   * La vela tocó stop y objetivo: sin datos intrabarra no se sabe cuál ocurrió antes.
   * Se resuelve como STOP por prudencia, pero queda contado para poder medir qué parte
   * de la curva depende de ese supuesto.
   */
  ambiguous: boolean;
}

export function evaluateExitOnBar(plan: ExecutedTradePlan, bar: Candle, profile: ExecutionCostProfile): TradeExit | null {
  const long = plan.direction === 'LONG';
  const stopHit = long ? bar.low <= plan.stop : bar.high >= plan.stop;
  const targetHit = long ? bar.high >= plan.target : bar.low <= plan.target;
  if (!stopHit && !targetHit) return null;
  const ambiguous = stopHit && targetHit;
  const reason: ExitReason = ambiguous && profile.conservativeSameBar ? 'STOP' : targetHit ? 'TARGET' : 'STOP';
  const requested = reason === 'STOP'
    ? (long ? Math.min(plan.stop, bar.open) : Math.max(plan.stop, bar.open))
    : plan.target;
  const exitFill = requested + (long ? -1 : 1) * (profile.spreadPrice / 2 + profile.slippagePrice);
  // Bruto y neto comparten denominador —el riesgo realmente asumido desde el precio de
  // llenado— y ambos parten de `entryFill`. Así la diferencia entre ambos es exactamente
  // el costo, en vez de mezclar costo con un cambio de base.
  const grossPrice = long ? requested - plan.entryFill : plan.entryFill - requested;
  const netPrice = long ? exitFill - plan.entryFill : plan.entryFill - exitFill;
  return {
    reason, exitFill, ambiguous,
    grossResultR:grossPrice / plan.riskPrice,
    netResultR:(netPrice - profile.commissionRoundTripPrice) / plan.riskPrice,
  };
}

export function closeAtEndOfData(plan: ExecutedTradePlan, close: number, profile: ExecutionCostProfile): TradeExit {
  const long = plan.direction === 'LONG';
  const exitFill = close + (long ? -1 : 1) * (profile.spreadPrice / 2 + profile.slippagePrice);
  const grossPrice = long ? close - plan.entryFill : plan.entryFill - close;
  const netPrice = long ? exitFill - plan.entryFill : plan.entryFill - exitFill;
  return {
    reason:'END_OF_DATA', exitFill, ambiguous:false,
    grossResultR:grossPrice / plan.riskPrice,
    netResultR:(netPrice - profile.commissionRoundTripPrice) / plan.riskPrice,
  };
}
