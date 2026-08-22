import type { Candle } from './analysisEngine';
import type { SentinelDecision } from './decisionContract';
import {
  evaluateExitOnBar,
  prepareExecutedTrade,
  type ExecutedTradePlan,
  type ExecutionCostProfile,
  type ExitReason,
} from './executionCostModel';

export type PaperStatus = 'PENDING_ENTRY' | 'OPEN' | 'CLOSED' | 'BLOCKED';

export interface PaperObservation {
  schemaVersion: 1;
  paperId: string;
  decision: SentinelDecision;
  executionProfileId: string;
  status: PaperStatus;
  createdAt: string;
  lastProcessedBarTime: string | null;
  plan: ExecutedTradePlan | null;
  enteredAt: string | null;
  closedAt: string | null;
  exitReason: ExitReason | null;
  grossResultR: number | null;
  netResultR: number | null;
  maeR: number | null;
  mfeR: number | null;
  reasonCodes: string[];
  liveOrderSent: false;
}

export interface PaperEvent {
  schemaVersion: 1;
  paperEventId: string;
  paperId: string;
  eventType: 'CREATED' | 'BAR_PROCESSED' | 'RECOVERY_BLOCKED';
  occurredAt: string;
  observation: PaperObservation;
}

function assertIso(value: string, field: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} debe ser ISO-8601 valido.`);
  return timestamp;
}

export function createPaperObservation(
  decision: SentinelDecision,
  profile: ExecutionCostProfile,
  createdAt: string,
): PaperObservation {
  assertIso(createdAt, 'createdAt');
  // Paper is the forward-only evidence generator used to move a model out of
  // RESEARCH/PROBATION. Requiring QUANT_ELIGIBLE here creates a circular gate:
  // Quant requires stable Paper evidence, while Paper could never collect it.
  // A blocked Quant verdict stays blocked; immature non-blocked verdicts may
  // be simulated because this engine can never send a live order.
  const quantCanCollectEvidence = ['RESEARCH', 'PROBATION', 'PRELIMINARY', 'ELIGIBLE'].includes(decision.quantStatus);
  const ready = decision.smcStatus === 'SMC_VALID'
    && quantCanCollectEvidence
    && decision.riskStatus === 'ACCEPTABLE'
    && decision.direction != null && decision.entry != null && decision.stop != null && decision.target != null;
  const evidenceReason = decision.quantStatus === 'ELIGIBLE'
    ? 'PAPER_FORWARD_ONLY'
    : `PAPER_${decision.quantStatus}_EVIDENCE_ONLY`;
  const recoveryReasons=decision.reasonCodes.includes('RECOVERY_GAP')?['RECOVERY_GAP','RECOVERY_GAP_NO_PERFORMANCE']:[];
  return {
    schemaVersion: 1,
    paperId: `PAPER:${decision.setupId}:${decision.timestamp}`,
    decision: structuredClone(decision),
    executionProfileId: profile.id,
    status: ready ? 'PENDING_ENTRY' : 'BLOCKED',
    createdAt,
    lastProcessedBarTime: null,
    plan: null,
    enteredAt: null,
    closedAt: null,
    exitReason: null,
    grossResultR: null,
    netResultR: null,
    maeR: null,
    mfeR: null,
    reasonCodes: ready ? [evidenceReason, 'NO_LIVE_ORDER'] : ['PAPER_DECISION_NOT_READY',...recoveryReasons,'NO_LIVE_ORDER'],
    liveOrderSent: false,
  };
}

export function advancePaperObservation(
  observation: PaperObservation,
  bar: Candle,
  profile: ExecutionCostProfile,
): PaperObservation {
  if (profile.id !== observation.executionProfileId) throw new Error('El perfil de ejecucion Paper no puede cambiar durante una observacion.');
  if (observation.status === 'BLOCKED' || observation.status === 'CLOSED') return structuredClone(observation);
  const barTime = assertIso(bar.time, 'bar.time');
  const decisionTime = assertIso(observation.decision.timestamp, 'decision.timestamp');
  const previousTime = observation.lastProcessedBarTime == null ? null : assertIso(observation.lastProcessedBarTime, 'lastProcessedBarTime');
  if (previousTime != null && barTime === previousTime) return structuredClone(observation);
  if (previousTime != null && barTime < previousTime) throw new Error('Paper Trading rechazo una vela fuera de orden.');
  if (barTime <= decisionTime) throw new Error('Paper Trading no puede procesar velas anteriores o iguales a la decision.');

  const next = structuredClone(observation);
  next.lastProcessedBarTime = bar.time;
  if (next.status === 'PENDING_ENTRY') {
    const { direction, stop, target } = next.decision;
    if (direction == null || stop == null || target == null) throw new Error('Decision Paper incompleta.');
    next.plan = prepareExecutedTrade(direction, bar.open, stop, target, profile);
    next.enteredAt = bar.time;
    next.status = 'OPEN';
  }
  const plan = next.plan;
  if (!plan) return next;
  const adversePrice = plan.direction === 'LONG' ? plan.entryFill - bar.low : bar.high - plan.entryFill;
  const favorablePrice = plan.direction === 'LONG' ? bar.high - plan.entryFill : plan.entryFill - bar.low;
  next.maeR = Math.max(next.maeR ?? 0, adversePrice / plan.riskPrice, 0);
  next.mfeR = Math.max(next.mfeR ?? 0, favorablePrice / plan.riskPrice, 0);
  const exit = evaluateExitOnBar(plan, bar, profile);
  if (exit) {
    next.status = 'CLOSED';
    next.closedAt = bar.time;
    next.exitReason = exit.reason;
    next.grossResultR = exit.grossResultR;
    next.netResultR = exit.netResultR;
    next.reasonCodes = [...next.reasonCodes, `PAPER_EXIT_${exit.reason}`];
  }
  return next;
}

export function blockPaperObservationForRecovery(observation: PaperObservation): PaperObservation {
  if (observation.status === 'BLOCKED' || observation.status === 'CLOSED') return structuredClone(observation);
  return {
    ...structuredClone(observation),
    status: 'BLOCKED',
    plan: null,
    enteredAt: null,
    closedAt: null,
    exitReason: null,
    grossResultR: null,
    netResultR: null,
    maeR: null,
    mfeR: null,
    reasonCodes: [...new Set([...observation.reasonCodes, 'RECOVERY_GAP', 'PAPER_RECOVERY_GAP', 'RECOVERY_GAP_NO_PERFORMANCE'])],
    liveOrderSent: false,
  };
}

export function createPaperEvent(
  eventType: PaperEvent['eventType'], observation: PaperObservation, occurredAt: string,
): PaperEvent {
  assertIso(occurredAt, 'occurredAt');
  const suffix = eventType === 'CREATED' ? 'CREATED'
    : eventType === 'RECOVERY_BLOCKED' ? `RECOVERY_BLOCKED:${occurredAt}`
      : observation.lastProcessedBarTime ?? occurredAt;
  return { schemaVersion: 1, paperEventId: `${observation.paperId}:${suffix}`, paperId: observation.paperId, eventType, occurredAt, observation: structuredClone(observation) };
}

export interface PaperStabilityConfig { minimumClosedTrades: number; minimumExpectancyR: number; minimumProfitFactor: number; }
export function evaluatePaperStability(observations: PaperObservation[], config: PaperStabilityConfig) {
  const returns = observations.filter(item => item.status === 'CLOSED' && item.netResultR != null).map(item => item.netResultR as number);
  const grossProfit = returns.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  const expectancyR = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;
  const stable = returns.length >= config.minimumClosedTrades && expectancyR != null && expectancyR >= config.minimumExpectancyR
    && profitFactor != null && profitFactor >= config.minimumProfitFactor;
  return { stable, closedTrades: returns.length, expectancyR, profitFactor, reasonCodes: stable ? ['PAPER_STABLE'] : ['PAPER_EVIDENCE_INSUFFICIENT_OR_FAILED'] };
}
