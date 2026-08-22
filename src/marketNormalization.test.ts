import { describe, expect, it } from 'vitest';
import { normalizeMarketSnapshot } from './marketNormalization';
import type { Candle } from './analysisEngine';

const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({ time:new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), open:100 + i, high:102 + i, low:99 + i, close:101 + i, tickVolume:100 + i }));
describe('multi-market normalization', () => {
  it('expresses spread, body and range without pips', () => {
    const result = normalizeMarketSnapshot(candles, { instrumentId:'CRYPTO:BTC/USD', canonicalSymbol:'BTC/USD', assetClass:'CRYPTO', provider:'MT5', broker:null, exchange:null, timezone:'UTC', tickSize:.01, pointSize:.01, contractSize:1 }, { bid:129, ask:129.1 });
    expect(result?.spreadATR).toBeGreaterThan(0);
    expect(result?.spreadBps).toBeGreaterThan(0);
    expect(result?.normalizationVersion).toBeTruthy();
  });
});
