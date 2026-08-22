import { describe, expect, it } from 'vitest';
import { evaluateCandleDataQuality } from './dataQualityEngine';
import type { Candle } from './analysisEngine';

const bar = (time: string, value = 100): Candle => ({ time, open:value, high:value + 1, low:value - 1, close:value + .5, tickVolume:10, spread:2 });
describe('Data Quality Engine', () => {
  it('accepts a clean ordered dataset', () => {
    const rows = Array.from({ length: 20 }, (_, index) => bar(new Date(Date.UTC(2026, 0, 1, 0, index * 5)).toISOString(), 100 + index));
    expect(evaluateCandleDataQuality(rows).status).toBe('DATA_VALID');
  });
  it('invalidates duplicate timestamps and impossible OHLC', () => {
    const rows = [bar('2026-01-01T00:00:00Z'), { ...bar('2026-01-01T00:00:00Z'), high:90 }];
    const report = evaluateCandleDataQuality(rows);
    expect(report.status).toBe('DATA_INVALID');
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['DUPLICATE_TIMESTAMP', 'INVALID_OHLC']));
  });
});
