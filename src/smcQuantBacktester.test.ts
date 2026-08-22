import { describe, expect, it, vi } from 'vitest';
import type { Candle } from './analysisEngine';
import { ZERO_COST_EXECUTION, type ExecutionCostProfile } from './executionCostModel';
import { runSmcQuantBacktest } from './smcQuantBacktester';
import type { SmcSetup, SmcTimeframeProfile } from './smcStrategy';
import { buildSetupFeatureVector } from './setupFeatureEngine';

const profile: SmcTimeframeProfile = { id:'TEST', bias:'D1', levels:'H4', setup:'H1', refinement:'M15', trigger:'M5' };
const bar = (time:string, open=100, high=101, low=99, close=100): Candle => ({ time, open, high, low, close });
const frames = {
  D1:[bar('2025-12-01T00:00:00Z')], H4:[bar('2026-01-01T04:00:00Z')],
  H1:[bar('2026-01-01T10:00:00Z')], M15:[bar('2026-01-01T10:15:00Z')],
  M5:[bar('2026-01-01T10:30:00Z'), bar('2026-01-01T10:35:00Z', 100, 105, 97, 101), bar('2026-01-01T10:40:00Z')],
};
const ids = { D1:'D-D1', H4:'D-H4', H1:'D-H1', M15:'D-M15', M5:'D-M5' };
const quality = { D1:'DATA_VALID', H4:'DATA_VALID', H1:'DATA_VALID', M15:'DATA_VALID', M5:'DATA_VALID' } as const;
const waiting = (): SmcSetup => ({ minimumRR:1.5, strategyId:'SMC_D1_H4_H1_M15_M5_V1', direction:null, stage:'D1_BIAS', score:0, steps:[], entry:null, stop:null, target:null, riskReward:null, reasons:[], warnings:[], facts:null, strategyVersion:'test', profileId:'TEST' });
const ready = (): SmcSetup => ({ ...waiting(), direction:'BUY', stage:'READY', score:100, entry:100, stop:98, target:104, riskReward:2 });
const builtFeatures = () => ({ ok:true as const, features:buildSetupFeatureVector({ instrumentId:'TEST:ONE', symbol:'ONE', assetClass:'CRYPTO', timestamp:'2026-01-01T10:35:00Z', direction:'LONG', d1Structure:'HH_HL', h4Structure:'HH_HL', h1LiquiditySweep:true, h1SweepSizeATR:.2, h1DisplacementATR:1.1, m15Fvg:true, m15FvgSizeATR:.2, m15FvgMitigationPercent:20, m5Break:true, m5BreakStrengthATR:1, distanceToLiquidityATR:2, premiumDiscountPosition:.3, plannedRR:2, atrPercent:1, atrPercentile:50, volatilityPercentile:50, volatilityRegime:'TRENDING_UP', trendStrength:60, directionalPersistence:70, session:'CRYPTO_24_7', hourOfDay:10, dayOfWeek:4, minutesFromSessionOpen:635, minutesFromSessionClose:805, spreadATR:.01, spreadBps:2 }) });

describe('causal SMC Quant backtester', () => {
  it('enters only on the following M5 bar and resolves ambiguous bars conservatively', () => {
    const analyze = vi.fn((available: Partial<Record<string, Candle[]>>) => available.M5?.length === 1 ? ready() : waiting());
    const result = runSmcQuantBacktest({ experimentId:'Q-1', datasetIds:ids, dataQuality:quality, frames, execution:ZERO_COST_EXECUTION, profile, analyze, buildFeatures:builtFeatures });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ signalTimestamp:'2026-01-01T10:35:00.000Z', entryTimestamp:'2026-01-01T10:35:00Z', exitReason:'STOP', grossResultR:-1, maeR:1.5, mfeR:2.5 });
  });
  it('never exposes an open H1 candle and is reproducible', () => {
    const observed:number[] = [];
    const analyze = (available: Partial<Record<string, Candle[]>>) => { observed.push(available.H1?.length ?? -1); return waiting(); };
    const input = { experimentId:'Q-2', datasetIds:ids, dataQuality:quality, frames, execution:ZERO_COST_EXECUTION, profile, analyze, buildFeatures:builtFeatures };
    expect(runSmcQuantBacktest(input)).toEqual(runSmcQuantBacktest(input));
    expect(observed[0]).toBe(0);
  });
  it('blocks invalid datasets and reports net costs separately', () => {
    expect(() => runSmcQuantBacktest({ experimentId:'Q-3', datasetIds:ids, dataQuality:{ ...quality, H1:'DATA_INVALID' }, frames, execution:ZERO_COST_EXECUTION, profile, buildFeatures:builtFeatures })).toThrow(/DATA_INVALID/);
    const execution: ExecutionCostProfile = { id:'COST', spreadPrice:.2, slippagePrice:.1, commissionRoundTripPrice:.1, latencyMs:0, conservativeSameBar:true };
    const result = runSmcQuantBacktest({ experimentId:'Q-4', datasetIds:ids, dataQuality:quality, frames, execution, profile, analyze:available => available.M5?.length === 1 ? ready() : waiting(), buildFeatures:builtFeatures });
    expect(result.netR).toBeLessThan(result.grossR);
  });
  it('does not count a ready SMC pattern when causal features cannot be built', () => {
    const result = runSmcQuantBacktest({ experimentId:'Q-5', datasetIds:ids, dataQuality:quality, frames, execution:ZERO_COST_EXECUTION, profile, instrument:{ instrumentId:'TEST:ONE', canonicalSymbol:'ONE', assetClass:'CRYPTO', provider:'TEST', broker:null, exchange:null, timezone:'UTC', tickSize:.01, pointSize:.01, contractSize:1 }, analyze:available => available.M5?.length === 1 ? ready() : waiting() });
    expect(result).toMatchObject({ candidates:[], featureFailures:1 });
  });
  it('uses the execution profile of each historical bar and applies configured portfolio risk',()=>{
    const result=runSmcQuantBacktest({experimentId:'Q-6',datasetIds:ids,dataQuality:quality,frames,execution:ZERO_COST_EXECUTION,profile,riskPercent:.5,executionForBar:(current,index)=>({...ZERO_COST_EXECUTION,id:`BAR-${index}`,spreadPrice:current.open/1000}),analyze:available=>available.M5?.length===1?ready():waiting(),buildFeatures:builtFeatures});
    expect(result.trades[0].entrySpreadPrice).toBe(frames.M5[1].open/1000);
    expect(result.trades[0].netResultPercent).toBeCloseTo(result.trades[0].netResultR*.5);
    expect(result.netReturnPercent).toBeCloseTo(result.netR*.5);
  });
  it('bounds causal history so processing does not grow quadratically with the full prefix',()=>{
    const many={...frames,M5:Array.from({length:200},(_,index)=>bar(new Date(Date.parse('2026-01-01T00:00:00Z')+index*300_000).toISOString()))},observed:number[]=[];
    runSmcQuantBacktest({experimentId:'Q-7',datasetIds:ids,dataQuality:quality,frames:many,execution:ZERO_COST_EXECUTION,profile,maxLookbackBars:80,analyze:available=>{observed.push(available.M5?.length??0);return waiting()},buildFeatures:builtFeatures});
    expect(Math.max(...observed)).toBe(80);
  });
});
