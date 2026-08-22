import { describe, expect, it } from 'vitest';
import { canonicalCandleChecksum, createDatasetProvenance } from './dataProvenance';
import type { Candle } from './analysisEngine';

const candles: Candle[] = [{ time:'2026-01-01T00:00:00Z', open:1, high:2, low:.5, close:1.5 }];
describe('dataset provenance', () => {
  it('is reproducible and changes when market data changes', () => {
    expect(canonicalCandleChecksum(candles)).toBe(canonicalCandleChecksum([...candles]));
    expect(canonicalCandleChecksum(candles)).not.toBe(canonicalCandleChecksum([{ ...candles[0], close:1.6 }]));
  });
  it('retains provider, identity and quality', () => {
    const result = createDatasetProvenance({ datasetId:'D-1', provider:'MT5', instrumentId:'FOREX:EUR/USD', symbol:'EUR/USD', assetClass:'FOREX', broker:'Demo', exchange:null, timezone:'UTC', resolution:'H1', downloadTimestamp:'2026-01-02T00:00:00Z', processingTimestamp:'2026-01-02T00:00:01Z', qualityStatus:'DATA_VALID', candles });
    expect(result).toMatchObject({ rows:1, provider:'MT5', checksumAlgorithm:'FNV1A32_CANONICAL_V1' });
  });
  it('derives the real time range even if invalid input is out of order', () => {
    const result = createDatasetProvenance({ datasetId:'D-2', provider:'MT5', instrumentId:'FOREX:EUR/USD', symbol:'EUR/USD', assetClass:'FOREX', broker:null, exchange:null, timezone:'UTC', resolution:'H1', downloadTimestamp:'2026-01-03T00:00:00Z', processingTimestamp:'2026-01-03T00:00:01Z', qualityStatus:'DATA_INVALID', qualityReportId:'DQ-2', candles:[{ ...candles[0], time:'2026-01-02T00:00:00Z' }, candles[0]] });
    expect(result).toMatchObject({ dateFrom:'2026-01-01T00:00:00.000Z', dateTo:'2026-01-02T00:00:00.000Z', qualityReportId:'DQ-2' });
  });
});
