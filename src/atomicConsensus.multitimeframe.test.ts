import { describe, expect, it } from 'vitest';
import { assessAtomic } from './atomicConsensus';
import { NO_VIX_DECISION_CONTEXT, type DecisionResult } from './decisionEngine';

const decision: DecisionResult = {
  decision: 'BUY_CONDICIONADO',
  confidence: 70,
  technicalConfidence: 70,
  eventAction: 'NORMAL',
  reasons: [],
  volatilityContext: NO_VIX_DECISION_CONTEXT,
};

const signal = (id: string, timeframe: string, type = 'BUY'): AtomicMt5Signal => ({
  id,
  type,
  symbol: 'EURUSD.m',
  timeframe,
  time: '2026.08.04 10:00',
  value: 1,
  buyBuffer: 11,
  sellBuffer: 12,
  source: 'Atomic Analyst MT5',
  raw: '',
});

describe('atomic consensus multitemporal', () => {
  it('selecciona la señal del marco solicitado aunque la última global pertenezca a otro', () => {
    const m5 = signal('m5', 'M5');
    const h1 = signal('h1', 'H1', 'SELL');
    const response: AtomicMt5Response = {
      ok: true,
      active: true,
      statusFileModifiedAt: new Date().toISOString(),
      signalFileModifiedAt: new Date().toISOString(),
      status: null,
      signals: [m5, h1],
      latest: h1,
    };

    const result = assessAtomic(response, 'EUR/USD', 'M5', decision);
    expect(result.signal?.id).toBe('m5');
    expect(result.agreement).toBe('CONFIRMA');
  });
});
