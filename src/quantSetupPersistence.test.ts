import { describe, expect, it, vi } from 'vitest';
import { persistBacktestSetups } from './quantSetupPersistence';
import { buildSetupFeatureVector } from './setupFeatureEngine';

describe('backtest setup persistence adapter', () => {
  it('persists every detected candidate, including non-executed observations', async () => {
    const features = buildSetupFeatureVector({ instrumentId:'TEST:ONE', symbol:'ONE', assetClass:'CRYPTO', timestamp:'2026-01-01T00:00:00Z', direction:'LONG', d1Structure:'HH_HL', h4Structure:'HH_HL', h1LiquiditySweep:true, h1SweepSizeATR:.2, h1DisplacementATR:1, m15Fvg:true, m15FvgSizeATR:.2, m15FvgMitigationPercent:10, m5Break:true, m5BreakStrengthATR:1, distanceToLiquidityATR:2, premiumDiscountPosition:.3, plannedRR:2, atrPercent:1, atrPercentile:50, volatilityPercentile:50, volatilityRegime:'TRENDING_UP', trendStrength:60, directionalPersistence:70, session:'CRYPTO_24_7', hourOfDay:0, dayOfWeek:4, minutesFromSessionOpen:0, minutesFromSessionClose:1440, spreadATR:null, spreadBps:null });
    const candidate = { setupId:'S-1', signalTimestamp:'2026-01-01T00:00:00Z', direction:'LONG' as const, plannedEntry:100, plannedStop:98, plannedTarget:104, plannedRR:2, profileId:'TEST', features };
    const store = { append:vi.fn(async () => ({ created:true })) };
    const records = await persistBacktestSetups({ experimentId:'Q-1', datasetIds:{ M5:'D-1' }, candidates:[candidate], trades:[], featureFailures:0, ambiguousExits:0, skippedInvalidPlans:0, grossR:0, netR:0 }, store, { spread:null, slippage:null });
    expect(store.append).toHaveBeenCalledOnce();
    expect(records[0]).toMatchObject({ setupId:'S-1', resultStatus:'NOT_EXECUTED' });
  });
});
