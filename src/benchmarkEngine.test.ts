import { describe, expect, it } from 'vitest';
import { runRandomSameRrBenchmark } from './benchmarkEngine';
import { ZERO_COST_EXECUTION } from './executionCostModel';

const candles = Array.from({ length:300 }, (_, index) => { const close = 100 + Math.sin(index / 8) * 2; return { time:new Date(1700000000000 + index * 300000).toISOString(), open:close, high:close + .5, low:close - .5, close }; });
describe('Random Same-RR benchmark', () => {
  it('is exactly reproducible for the same seed', () => {
    const input = { candles, tradeCount:25, rewardRisk:2, atrMultiple:1, execution:ZERO_COST_EXECUTION, randomSeed:42 };
    expect(runRandomSameRrBenchmark(input)).toEqual(runRandomSameRrBenchmark(input));
  });
  it('changes sampling with a different seed and keeps requested sample size', () => {
    const a = runRandomSameRrBenchmark({ candles, tradeCount:20, rewardRisk:2, atrMultiple:1, execution:ZERO_COST_EXECUTION, randomSeed:1 });
    const b = runRandomSameRrBenchmark({ candles, tradeCount:20, rewardRisk:2, atrMultiple:1, execution:ZERO_COST_EXECUTION, randomSeed:2 });
    expect(a.completedTrades).toBe(20);
    expect(a.returns).not.toEqual(b.returns);
  });
});
