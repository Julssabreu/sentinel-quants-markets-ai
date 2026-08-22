import { describe,expect,it } from 'vitest';
import { createDefaultQuantLaboratoryConfig } from './quantLaboratoryModel';
import { filterQuantSeriesByDate,resolveSmcResearchOptions,runPreparedSmcBacktest,validateQuantDatasetConfig,type StoredQuantDataset } from './quantBacktestRunner';

const durations=[86_400_000,14_400_000,3_600_000,900_000,300_000];
const frames=Object.fromEntries(['D1','H4','H1','M15','M5'].map((frame,index)=>[
  frame,Array.from({length:80},(_,i)=>({time:new Date(Date.UTC(2025,0,1)+i*durations[index]).toISOString(),open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.5+i*.01,tickVolume:10,spread:1,realVolume:0})),
]));
const dataset:StoredQuantDataset={
  provenance:{datasetId:'D1',provider:'MT5',instrumentId:'FX_EURUSD',symbol:'EURUSD',assetClass:'FOREX',timezone:'UTC',pointSize:.01,tickSize:.01,dateFrom:'2025-01-01',dateTo:'2025-03-21',resolution:'MULTI_TIMEFRAME',rows:400,checksum:'abc',qualityStatus:'DATA_VALID',qualityReportId:'Q1'},
  raw:{schemaVersion:2,provider:'MT5',symbol:'EURUSD',instrumentId:'FX_EURUSD',assetClass:'FOREX',processingTimestamp:'2026-01-01T00:00:00Z',pointSize:.01,tickSize:.01,series:frames},
};

describe('quantBacktestRunner',()=>{
  it('ejecuta causalmente y aplica riesgo, RR y costes por barra',()=>{
    const config=createDefaultQuantLaboratoryConfig(),output=runPreparedSmcBacktest({experimentId:'Q-1',datasetId:'D1',dataset,config,now:'2026-01-01T00:00:00Z'});
    expect(output.result.experimentId).toBe('Q-1');
    expect(output.statistics.sampleSize).toBe(output.result.trades.length);
    expect(output.execution).toMatchObject({conservativeSameBar:true,costModel:'PER_BAR_HISTORICAL_SPREAD_OR_BPS',historicalSpreadUsed:true});
    expect(output.execution.spreadSource).toBe('HISTORICAL_POINTS');
    expect(output.appliedRisk).toMatchObject({riskPercent:.5,minimumRR:1.5,model:'FIXED_FRACTION_NON_COMPOUNDED'});
    expect(output.result.riskPercent).toBe(.5);
    expect(resolveSmcResearchOptions({...config,risk:{...config.risk,minimumRR:2.25}}).parameters?.minimumRR).toBe(2.25);
  });

  it('bloquea zona horaria no verificada y velas aún abiertas',()=>{
    const config=createDefaultQuantLaboratoryConfig();
    expect(()=>runPreparedSmcBacktest({experimentId:'Q-TZ',datasetId:'D1',dataset:{...dataset,provenance:{...dataset.provenance,timezone:'BROKER_SERVER_UNVERIFIED'}},config,now:'2026-01-01T00:00:00Z'})).toThrow(/zona horaria verificada/);
    const future={...frames.M5[0],time:'2026-01-01T00:00:00Z'};
    const withOpen:StoredQuantDataset={...dataset,raw:{...dataset.raw,series:{...dataset.raw.series,M5:[...dataset.raw.series.M5,future]}}};
    expect(()=>runPreparedSmcBacktest({experimentId:'Q-FUTURE',datasetId:'D1',dataset:withOpen,config:{...config,dateTo:'2026-01-01'},now:'2026-01-01T00:02:00Z'})).toThrow(/no cerrada/);
  });

  it('rechaza identidad, símbolo EUR/BTC, clase y calidad incompatibles',()=>{
    const config=createDefaultQuantLaboratoryConfig();
    expect(()=>runPreparedSmcBacktest({experimentId:'Q-1',datasetId:'OTHER',dataset,config,now:'2026-01-01T00:00:00Z'})).toThrow(/no coincide/);
    expect(()=>runPreparedSmcBacktest({experimentId:'Q-1',datasetId:'D1',dataset:{...dataset,provenance:{...dataset.provenance,qualityStatus:'DATA_INVALID'}},config,now:'2026-01-01T00:00:00Z'})).toThrow(/DATA_INVALID/);
    const btc={provenance:{...dataset.provenance,instrumentId:'CRYPTO_BTCUSD',symbol:'BTCUSD',assetClass:'CRYPTO'},raw:{...dataset.raw,instrumentId:'CRYPTO_BTCUSD',symbol:'BTCUSD',assetClass:'CRYPTO'}};
    expect(()=>validateQuantDatasetConfig(btc,config)).toThrow(/experimento declara FOREX/);
    const gbp={provenance:{...dataset.provenance,instrumentId:'FX_GBPUSD',symbol:'GBPUSD'},raw:{...dataset.raw,instrumentId:'FX_GBPUSD',symbol:'GBPUSD'}};
    expect(()=>validateQuantDatasetConfig(gbp,config)).toThrow(/símbolo configurado EURUSD no coincide/);
  });

  it('filtra de forma inclusiva por días UTC y excluye todo lo posterior a dateTo',()=>{
    const series={M5:[
      {...frames.M5[0],time:'2024-12-31T23:55:00Z'},
      {...frames.M5[0],time:'2025-01-01T00:00:00Z'},
      {...frames.M5[0],time:'2025-01-31T23:55:00Z'},
      {...frames.M5[0],time:'2025-02-01T00:00:00Z'},
    ]};
    const filtered=filterQuantSeriesByDate(series,'2025-01-01','2025-01-31');
    expect(filtered.series.M5.map(bar=>bar.time)).toEqual(['2025-01-01T00:00:00Z','2025-01-31T23:55:00Z']);
    expect(filtered.dateRange.toExclusive).toBe('2025-02-01T00:00:00.000Z');
  });

  it('no cambia costes base al anexar un precio futuro',()=>{
    const config=createDefaultQuantLaboratoryConfig(),base=runPreparedSmcBacktest({experimentId:'Q-A',datasetId:'D1',dataset,config,now:'2026-01-01T00:00:00Z'});
    const withFuture:StoredQuantDataset={...dataset,raw:{...dataset.raw,series:{...dataset.raw.series,M5:[...dataset.raw.series.M5,{time:'2025-12-01T00:00:00Z',open:10000,high:10001,low:9999,close:10000.5,spread:1}]}}};
    const future=runPreparedSmcBacktest({experimentId:'Q-B',datasetId:'D1',dataset:withFuture,config,now:'2026-01-01T00:00:00Z'});
    expect(future.execution.slippagePrice).toBe(base.execution.slippagePrice);
    expect(future.execution.commissionRoundTripPrice).toBe(base.execution.commissionRoundTripPrice);
  });
});
