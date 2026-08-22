import { describe, expect, it } from 'vitest';
import { buildSetupFeatureVector, createSetupFeatureVector } from './setupFeatureEngine';
import type { Candle } from './analysisEngine';
import { DEFAULT_SMC_TIMEFRAME_PROFILE } from './smcStrategy';

describe('Setup Feature Engine contract', () => {
  it('preserves continuous SMC measurements and versions the vector', () => {
    const feature = buildSetupFeatureVector({
      instrumentId:'CRYPTO:BTC/USD', symbol:'BTC/USD', assetClass:'CRYPTO', timestamp:'2026-08-15T12:00:00Z', direction:'LONG',
      d1Structure:'HH_HL', h4Structure:'BULLISH', h1LiquiditySweep:true, h1SweepSizeATR:.37, h1DisplacementATR:1.52,
      m15Fvg:true, m15FvgSizeATR:.21, m15FvgMitigationPercent:35, m5Break:true, m5BreakStrengthATR:1.31,
      distanceToLiquidityATR:2.17, premiumDiscountPosition:.32, plannedRR:2.3, atrPercent:1.8, atrPercentile:68,
      volatilityPercentile:64, volatilityRegime:'TRENDING_UP', trendStrength:72, directionalPersistence:70,
      session:'CRYPTO_24_7', hourOfDay:12, dayOfWeek:6, minutesFromSessionOpen:720, minutesFromSessionClose:720,
      spreadATR:.012, spreadBps:3,
    });
    expect(feature.h1DisplacementATR).toBe(1.52);
    expect(feature.featureVersion).toMatch(/research/);
  });
});

describe('causal setup feature construction', () => {
  it('refuses incomplete normalization instead of inventing values', () => {
    const result = createSetupFeatureVector({
      setup:{ minimumRR:1.5, strategyId:'SMC_D1_H4_H1_M15_M5_V1', direction:'BUY', stage:'READY', score:100, steps:[], entry:100, stop:98, target:104, riskReward:2, reasons:[], warnings:[], strategyVersion:'test', profileId:'test', facts:{ direction:'LONG', d1Structure:'HH_HL', h4Structure:'HH_HL', h1LiquiditySweep:true, h1SweepSizeATR:.3, h1DisplacementATR:1.2, m15Fvg:true, m15FvgSizeATR:.2, m15FvgMitigationPercent:25, m5Break:true, m5BreakStrengthATR:1.1, distanceToLiquidityATR:2, premiumDiscountPosition:.3, plannedRR:2 } },
      frames:{ M5:[] }, profile:DEFAULT_SMC_TIMEFRAME_PROFILE,
      instrument:{ instrumentId:'CRYPTO:BTC/USD', canonicalSymbol:'BTC/USD', assetClass:'CRYPTO', provider:'TEST', broker:null, exchange:'TEST', timezone:'UTC', tickSize:.01, pointSize:.01, contractSize:1 },
      timestamp:'2026-01-01T00:00:00Z', spreadPrice:.1,
    });
    expect(result).toEqual({ ok:false, reasonCode:'FEATURE_NORMALIZATION_UNAVAILABLE' });
  });
  it('builds continuous normalized, regime and session features from available bars', () => {
    const bars: Candle[] = Array.from({ length:100 }, (_, index) => ({ time:new Date(Date.parse('2026-01-01T00:00:00Z') + index * 300_000).toISOString(), open:100 + index * .1, high:100.3 + index * .1, low:99.8 + index * .1, close:100.1 + index * .1 }));
    const base = { minimumRR:1.5, strategyId:'SMC_D1_H4_H1_M15_M5_V1' as const, direction:'BUY' as const, stage:'READY' as const, score:100, steps:[], entry:110, stop:108, target:114, riskReward:2, reasons:[], warnings:[], strategyVersion:'test', profileId:'test', facts:{ direction:'LONG' as const, d1Structure:'HH_HL', h4Structure:'HH_HL', h1LiquiditySweep:true, h1SweepSizeATR:.3, h1DisplacementATR:1.2, m15Fvg:true, m15FvgSizeATR:.2, m15FvgMitigationPercent:25, m5Break:true, m5BreakStrengthATR:1.1, distanceToLiquidityATR:2, premiumDiscountPosition:.3, plannedRR:2 } };
    const result = createSetupFeatureVector({ setup:base, frames:{ M5:bars, H1:bars }, profile:DEFAULT_SMC_TIMEFRAME_PROFILE, instrument:{ instrumentId:'CRYPTO:BTC/USD', canonicalSymbol:'BTC/USD', assetClass:'CRYPTO', provider:'TEST', broker:null, exchange:'TEST', timezone:'UTC', tickSize:.01, pointSize:.01, contractSize:1 }, timestamp:bars.at(-1)!.time, spreadPrice:.1 });
    expect(result.ok && result.features).toMatchObject({ assetClass:'CRYPTO', session:'CRYPTO_24_7', h1DisplacementATR:1.2 });
    expect(result.ok && result.features.atrPercent).toBeGreaterThan(0);
  });
});
