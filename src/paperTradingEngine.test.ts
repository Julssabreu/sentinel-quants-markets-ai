import { describe, expect, it } from 'vitest';
import type { SentinelDecision } from './decisionContract';
import type { ExecutionCostProfile } from './executionCostModel';
import { advancePaperObservation, createPaperEvent, createPaperObservation, evaluatePaperStability } from './paperTradingEngine';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

const profile: ExecutionCostProfile = { id:'PAPER_FX_V1', spreadPrice:0, slippagePrice:0, commissionRoundTripPrice:0, latencyMs:0, conservativeSameBar:true };
const decision = (status: SentinelDecision['finalStatus']='READY_TO_PRESENT'): SentinelDecision => ({
  schemaVersion:1, setupId:'S1', instrumentId:'FX_EUR_USD', timestamp:'2026-01-01T10:00:00Z', smcStatus:'SMC_VALID',
  quantStatus:'ELIGIBLE', riskStatus:'ACCEPTABLE', executionStatus:'ANALYSIS_ONLY', direction:'LONG', entry:100, stop:99, target:102,
  plannedRR:2, quantMetrics:{}, reasonCodes:[], versions:SENTINEL_QUANT_VERSIONS, finalStatus:status,
});

describe('paper trading forward-only', () => {
  it('acumula evidencia research sin habilitar orden live y respeta bloqueos Quant', () => {
    const researchDecision={...decision('QUANT_RESEARCH'),quantStatus:'RESEARCH' as const};
    expect(createPaperObservation(researchDecision,profile,'2026-01-01T10:00:01Z')).toMatchObject({status:'PENDING_ENTRY',liveOrderSent:false,reasonCodes:['PAPER_RESEARCH_EVIDENCE_ONLY','NO_LIVE_ORDER']});
    const blockedDecision={...researchDecision,quantStatus:'BLOCKED' as const,finalStatus:'QUANT_BLOCKED' as const};
    expect(createPaperObservation(blockedDecision,profile,'2026-01-01T10:00:01Z')).toMatchObject({status:'BLOCKED',liveOrderSent:false,reasonCodes:['PAPER_DECISION_NOT_READY','NO_LIVE_ORDER']});
  });
  it('entra en la siguiente vela y resuelve stop/target simultaneos conservadoramente', () => {
    const pending=createPaperObservation(decision(),profile,'2026-01-01T10:00:01Z');
    const closed=advancePaperObservation(pending,{time:'2026-01-01T10:05:00Z',open:100,high:102.1,low:98.9,close:101},profile);
    expect(closed).toMatchObject({status:'CLOSED',enteredAt:'2026-01-01T10:05:00Z',exitReason:'STOP',grossResultR:-1,netResultR:-1,liveOrderSent:false});
    expect(closed.maeR).toBeCloseTo(1.1); expect(closed.mfeR).toBeCloseTo(2.1);
  });
  it('es idempotente para la misma vela y rechaza desorden temporal', () => {
    const pending=createPaperObservation(decision(),profile,'2026-01-01T10:00:01Z');
    const open=advancePaperObservation(pending,{time:'2026-01-01T10:05:00Z',open:100,high:100.5,low:99.5,close:100.2},profile);
    expect(advancePaperObservation(open,{time:'2026-01-01T10:05:00Z',open:100,high:102,low:98,close:101},profile)).toEqual(open);
    expect(()=>advancePaperObservation(open,{time:'2026-01-01T10:04:00Z',open:100,high:101,low:99,close:100},profile)).toThrow(/fuera de orden/);
  });
  it('versiona eventos y exige evidencia configurable para estabilidad', () => {
    const pending=createPaperObservation(decision(),profile,'2026-01-01T10:00:01Z');
    const event=createPaperEvent('CREATED',pending,'2026-01-01T10:00:01Z');
    expect(event.paperEventId).toContain(':CREATED');
    expect(evaluatePaperStability([],{minimumClosedTrades:1,minimumExpectancyR:0,minimumProfitFactor:1}).stable).toBe(false);
    const win=advancePaperObservation(pending,{time:'2026-01-01T10:05:00Z',open:100,high:102.1,low:99.5,close:102},profile);
    expect(evaluatePaperStability([win],{minimumClosedTrades:1,minimumExpectancyR:0,minimumProfitFactor:1})).toMatchObject({stable:true,closedTrades:1});
  });
});
