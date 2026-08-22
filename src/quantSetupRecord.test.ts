import { describe, expect, it } from 'vitest';
import { createQuantSetupRecord } from './quantSetupRecord';
import { buildSetupFeatureVector } from './setupFeatureEngine';
// @ts-expect-error CommonJS backend guard is exercised by Vitest.
import persistenceGuard from '../shared/quantPersistenceGuard.cjs';

const features = buildSetupFeatureVector({ instrumentId:'CRYPTO:BTC/USD', symbol:'BTC/USD', assetClass:'CRYPTO', timestamp:'2026-01-01T10:35:00.000Z', direction:'LONG', d1Structure:'HH_HL', h4Structure:'HH_HL', h1LiquiditySweep:true, h1SweepSizeATR:.2, h1DisplacementATR:1.2, m15Fvg:true, m15FvgSizeATR:.2, m15FvgMitigationPercent:20, m5Break:true, m5BreakStrengthATR:1.1, distanceToLiquidityATR:2, premiumDiscountPosition:.3, plannedRR:2, atrPercent:1, atrPercentile:50, volatilityPercentile:50, volatilityRegime:'TRENDING_UP', trendStrength:60, directionalPersistence:70, session:'CRYPTO_24_7', hourOfDay:10, dayOfWeek:4, minutesFromSessionOpen:635, minutesFromSessionClose:805, spreadATR:.01, spreadBps:2 });
const candidate = { setupId:'Q-1:2026-01-01T10:35:00.000Z', signalTimestamp:'2026-01-01T10:35:00.000Z', direction:'LONG' as const, plannedEntry:100, plannedStop:98, plannedTarget:104, plannedRR:2, profileId:'TEST', features };
describe('Quant setup historical record', () => {
  it('keeps planned and actual execution separate with full versions', () => {
    const trade = { ambiguousExit:false, setupId:candidate.setupId, signalTimestamp:candidate.signalTimestamp, entryTimestamp:'2026-01-01T10:35:00Z', exitTimestamp:'2026-01-01T10:40:00Z', direction:'LONG' as const, requestedEntry:101, entryFill:101.1, stop:98, target:104, exitFill:98, exitReason:'STOP' as const, grossResultR:-1, netResultR:-1.1, maeR:1.2, mfeR:.3, strategyVersion:'x', executionModelVersion:'y' };
    const record = createQuantSetupRecord({ experimentId:'Q-1', datasetIds:{ M5:'D-1' }, candidate, trade, receivedTimestamp:candidate.signalTimestamp, processingTimestamp:candidate.signalTimestamp, createdAt:candidate.signalTimestamp, spread:.1, slippage:.05 });
    expect(record).toMatchObject({ entry:100, actualEntry:101.1, resultStatus:'COMPLETED', quantStatusAtEntry:'RESEARCH', experimentId:'Q-1' });
    expect(record.versions.smcBacktester).toBeTruthy();
  });
  it('stores non-executed candidates without fabricating results', () => {
    const record = createQuantSetupRecord({ experimentId:'Q-1', datasetIds:{ M5:'D-1' }, candidate, receivedTimestamp:candidate.signalTimestamp, processingTimestamp:candidate.signalTimestamp, createdAt:candidate.signalTimestamp, spread:null, slippage:null });
    expect(record).toMatchObject({ actualEntry:null, netResultR:null, resultStatus:'NOT_EXECUTED' });
  });
  it('backend guard rejects a risk-scaled result altered by the renderer',()=>{
    const trade={ambiguousExit:false,setupId:candidate.setupId,signalTimestamp:candidate.signalTimestamp,entryTimestamp:'2026-01-01T10:35:00Z',exitTimestamp:'2026-01-01T10:40:00Z',direction:'LONG' as const,requestedEntry:100,entryFill:100.1,stop:98,target:104,exitFill:104,exitReason:'TARGET' as const,grossResultR:2,netResultR:1.9,maeR:.2,mfeR:2,strategyVersion:'x',executionModelVersion:'y'};
    const record=createQuantSetupRecord({experimentId:'Q-1',datasetIds:{M5:'D-1'},candidate,trade,receivedTimestamp:candidate.signalTimestamp,processingTimestamp:candidate.signalTimestamp,createdAt:candidate.signalTimestamp,spread:.1,slippage:.05,riskPercent:.5});
    expect(()=>persistenceGuard.assertQuantSetup(record)).not.toThrow();
    expect(()=>persistenceGuard.assertQuantSetup({...record,netResultPercent:99})).toThrow(/netResultPercent/);
  });
});
