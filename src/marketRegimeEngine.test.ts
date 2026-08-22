import { describe, expect, it } from 'vitest';
import { classifyQuantMarketRegime } from './marketRegimeEngine';
import type { Candle } from './analysisEngine';

const trend: Candle[] = Array.from({ length: 120 }, (_, i) => ({ time:new Date(Date.UTC(2026, 0, i + 1)).toISOString(), open:100 + i, high:101.5 + i, low:99.5 + i, close:101 + i }));
describe('Market Regime Engine', () => {
  it('returns continuous context together with a category', () => {
    const result = classifyQuantMarketRegime(trend);
    expect(result.regime).not.toBe('UNKNOWN');
    expect(result.trendStrength).toBeGreaterThan(0);
    expect(result.atrPercentile).toBeGreaterThanOrEqual(0);
  });
  it('does not classify insufficient data confidently', () => {
    expect(classifyQuantMarketRegime(trend.slice(0, 20)).regime).toBe('UNKNOWN');
  });
});
