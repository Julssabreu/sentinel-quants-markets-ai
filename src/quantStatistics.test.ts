import { describe, expect, it } from 'vitest';
import { calculateQuantStatistics } from './quantStatistics';

describe('Quant statistics', () => {
  it('calculates net expectancy, PF, payoff, drawdown and loss streaks', () => {
    const result = calculateQuantStatistics([2, -1, -1, 2, -1]);
    expect(result).toMatchObject({ sampleSize:5, wins:2, losses:3, expectancyR:.2, profitFactor:4/3, payoffRatio:2, maxDrawdownR:2, maxConsecutiveLosses:2, medianTradeR:-1 });
    expect(result.expectancy95CI.lower).toBeLessThan(result.expectancyR!);
    expect(result.expectancy95CI.upper).toBeGreaterThan(result.expectancyR!);
  });
  it('does not report infinite or fabricated ratios for empty/no-loss samples', () => {
    expect(calculateQuantStatistics([])).toMatchObject({ sampleSize:0, expectancyR:null, profitFactor:null, winRate:null });
    expect(calculateQuantStatistics([1, 2]).profitFactor).toBeNull();
  });
  it('filters non-finite observations explicitly', () => {
    expect(calculateQuantStatistics([1, Number.NaN, -1, Number.POSITIVE_INFINITY]).sampleSize).toBe(2);
  });
});
