import { describe, expect, it } from 'vitest';
import { evaluateSmcQuantGate } from './quantSmcGate';
import type { SmcSetup } from './smcStrategy';

const setup = (stage: SmcSetup['stage'], riskReward: number | null): SmcSetup => ({ minimumRR:1.5,
  strategyId: 'SMC_D1_H4_H1_M15_M5_V1', direction: 'BUY', stage, score: stage === 'READY' ? 100 : 65,
  steps: [], entry: 100, stop: 99, target: 102, riskReward, reasons: [], warnings: [], facts:null,
  strategyVersion:'1.0.0-research', profileId:'SMC_DEFAULT_D1_H4_H1_M15_M5_V1',
});

describe('SMC quantitative gate', () => {
  it('never authorizes a setup without resolved evidence', () => {
    expect(evaluateSmcQuantGate(setup('READY', 2))).toMatchObject({ status: 'RESEARCH', authorized: false });
  });
  it('blocks evidence with negative expectancy', () => {
    expect(evaluateSmcQuantGate(setup('READY', 2), { resolvedTrades: 80, averageR: -.1, profitFactor: .8, maxDrawdownR: 8 }))
      .toMatchObject({ status: 'BLOCKED', authorized: false });
  });
  it('keeps positive evidence preliminary without OOS, walk-forward and paper', () => {
    const evidence = { resolvedTrades: 250, averageR: .18, profitFactor: 1.35, maxDrawdownR: 7 };
    expect(evaluateSmcQuantGate(setup('READY', 2), evidence)).toMatchObject({ status:'PRELIMINARY', authorized:false });
  });
  it('authorizes only a complete setup with all validation gates', () => {
    const evidence = { resolvedTrades: 300, averageR: .18, profitFactor: 1.35, maxDrawdownR: 7, outOfSampleAverageR:.12, outOfSampleProfitFactor:1.2, walkForwardStable:true, paperTradingStable:true, sampleQuality:75 };
    expect(evaluateSmcQuantGate(setup('M5_TRIGGER', 2), evidence).authorized).toBe(false);
    expect(evaluateSmcQuantGate(setup('READY', 2), evidence)).toMatchObject({ status: 'ELIGIBLE', authorized: true });
  });
});
