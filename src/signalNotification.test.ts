import { describe, expect, it } from 'vitest';
import {
  formatSignalNotification,
  formatDecisionPostureLines,
  formatSimulatedPlanLine,
  isActionableSignal,
  signalFingerprint,
  type SignalNotificationCandidate,
} from './signalNotification';
import { NO_VIX_DECISION_CONTEXT, type DecisionVolatilityContext } from './decisionEngine';
import type {DecisionPosture} from './decisionPosture';

const candidate: SignalNotificationCandidate = {
  symbol: 'BTC/USD',
  timeframe: 'H1',
  checkedAt: '2026-08-02T12:00:00Z',
  riskPercent: .5,
  decision: {
    decision: 'BUY_CONDICIONADO', confidence: 76, technicalConfidence: 80,
    eventAction: 'NORMAL', reasons: [], volatilityContext: NO_VIX_DECISION_CONTEXT,
  },
  atomic: {
    agreement: 'CONFIRMA',
    signal: { id: '1', type: 'BUY', symbol: 'BTCUSD', timeframe: 'H1', time: null, value: 1, buyBuffer: 0, sellBuffer: 1, source: 'Atomic', raw: '' },
    reason: 'Coincide', advisoryDecision: 'BUY_CONDICIONADO',
  },
  plan: {
    active: true, direction: 'BUY', trigger: 68420, maxEntry: 68510, stop: 67880,
    tp1: 69230, tp2: 70050, riskReward1: 1.5, riskReward2: 3.02, atr: 500,
    expiresAfterBars: 3, cancellation: [],
  },
};

const stressedVix: DecisionVolatilityContext = {
  value: 31.42,
  regime: 'EXTREMO',
  trend: 'SUBIENDO',
  freshness: 'VIGENTE',
  observedAt: '2026-08-01T20:00:00Z',
  influence: 'PENALIZA_CORROBORADO',
  confidencePenalty: 5,
  ruleVersion: 'VIX_CONTEXT_V1',
};

describe('signal notifications', () => {
  it('acepta planes completos y confirmados', () => expect(isActionableSignal(candidate)).toBe(true));
  it('rechaza contradicciones', () => expect(isActionableSignal({ ...candidate, atomic: { ...candidate.atomic, agreement: 'CONTRADICE' } })).toBe(false));
  it('incluye niveles, VIX como contexto y advertencia', () => {
    const text = formatSignalNotification({
      ...candidate,
      decision: { ...candidate.decision, volatilityContext: stressedVix },
    });
    expect(text).toContain('Entrada/trigger: 68,420');
    expect(text).toContain('Stop Loss: 67,880');
    expect(text).toContain('VIX diario (contexto, no señal): 31.42');
    expect(text).toContain('ajuste corroborado -5 pts');
    expect(text).toContain('Orden no ejecutada');
  });
  it('deduplica por contenido operativo y contexto VIX, no por hora de consulta', () => {
    expect(signalFingerprint(candidate)).toBe(signalFingerprint({ ...candidate, checkedAt: '2026-08-02T13:00:00Z' }));
    const withVix = { ...candidate, decision: { ...candidate.decision, volatilityContext: stressedVix } };
    expect(signalFingerprint(withVix)).not.toBe(signalFingerprint(candidate));
    expect(signalFingerprint(withVix)).not.toBe(signalFingerprint({
      ...withVix,
      decision: { ...withVix.decision, volatilityContext: { ...stressedVix, observedAt: '2026-08-02T20:00:00Z' } },
    }));
  });
  it('forma el encabezado real con sesgo, madurez y ejecución desactivada',()=>{
    const posture:DecisionPosture={
      analyticalLabel:'SESGO BUY',analyticalDecision:'BUY_CONDICIONADO',analyticalConfidence:68,
      maturityStatus:'RESEARCH',maturitySample:0,recommendationStatus:'RESEARCH_ONLY',
      recommendationAuthorized:false,executionStatus:'DISABLED',executionAuthorized:false,
      simulationEligible:true,reasons:['Modelo en investigación.'],summary:'Sesgo BUY.',
    };
    const text=formatDecisionPostureLines(posture).join('\n');
    expect(text).toContain('SESGO BUY 68%');
    expect(text).toContain('modelo RESEARCH · 0/30');
    expect(text).toContain('Ejecución: DISABLED');
    expect(formatSimulatedPlanLine(posture,candidate.plan)).toContain('PLAN SIMULADO: entrada');
    expect(formatSimulatedPlanLine({...posture,simulationEligible:false},candidate.plan)).not.toContain('68,420');
  });
});
