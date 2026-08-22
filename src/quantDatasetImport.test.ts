import { describe,expect,it } from 'vitest';
// @ts-expect-error CommonJS production module executed by Vitest.
import datasetImport from '../shared/quantDatasetImport.cjs';
const {buildMt5DatasetBundle}=datasetImport;
const bar=(time:string,overrides={})=>({time,open:100,high:102,low:99,close:101,tickVolume:5,spread:1,realVolume:0,...overrides});
describe('quantDatasetImport',()=>{
  it('excluye la vela abierta y genera identidad determinista',()=>{
    const input={symbol:'EURUSD',instrumentId:'FX_EUR_USD',assetClass:'FOREX',timeframes:['H1'],processingTimestamp:'2026-01-01T11:30:00Z',normalizationVersion:'1',response:{results:{H1:{ok:true,symbol:'EURUSD',digits:5,specification:{tickSize:.00001},candles:[bar('2026-01-01T09:00:00Z'),bar('2026-01-01T11:00:00Z')]}}}};
    const first=buildMt5DatasetBundle(input),second=buildMt5DatasetBundle(input);
    expect(first.provenance.rowsByTimeframe.H1).toBe(1);
    expect(first.provenance.qualityReports[0].excludedOpenBars).toBe(1);
    expect(first.provenance.datasetId).toBe(second.provenance.datasetId);
    expect(first.provenance).toMatchObject({timezone:'UTC',pointSize:.00001,tickSize:.00001});
    expect(first.raw).toMatchObject({pointSize:.00001,tickSize:.00001});
  });
  it('mantiene identidad por contenido aunque cambie la hora de importación',()=>{
    const base={symbol:'EURUSD',instrumentId:'FX_EUR_USD',assetClass:'FOREX',timeframes:['H1'],normalizationVersion:'2',response:{results:{H1:{ok:true,symbol:'EURUSD',candles:[bar('2026-01-02T20:00:00Z'),bar('2026-01-04T21:00:00Z')]}}}};
    const first=buildMt5DatasetBundle({...base,processingTimestamp:'2026-01-05T12:00:00Z'}),second=buildMt5DatasetBundle({...base,processingTimestamp:'2026-01-05T12:01:00Z'});
    expect(first.provenance.datasetId).toBe(second.provenance.datasetId);
    expect(first.provenance.checksum).toBe(second.provenance.checksum);
  });
  it('no confunde el cierre semanal FOREX con datos faltantes',()=>{
    const result=buildMt5DatasetBundle({symbol:'EURUSD',instrumentId:'FX_EUR_USD',assetClass:'FOREX',timeframes:['H1'],processingTimestamp:'2026-01-05T12:00:00Z',normalizationVersion:'2',response:{results:{H1:{ok:true,symbol:'EURUSD',candles:[bar('2026-01-02T20:00:00Z'),bar('2026-01-04T21:00:00Z')]}}}});
    expect(result.provenance.qualityReports[0].issues).not.toEqual(expect.arrayContaining([expect.objectContaining({code:'MISSING_INTERVALS'})]));
  });
  it('excluye un prefijo de resolución gruesa en vez de degradar toda la serie',()=>{
    const coarse=Array.from({length:25},(_,index)=>bar(new Date(Date.UTC(2025,0,index+1)).toISOString()));
    const start=Date.UTC(2025,1,1),hourly=Array.from({length:250},(_,index)=>bar(new Date(start+index*3600000).toISOString()));
    const result=buildMt5DatasetBundle({symbol:'BTCUSD',instrumentId:'CRYPTO_BTC_USD',assetClass:'CRYPTO',timeframes:['H1'],processingTimestamp:'2025-03-01T00:00:00Z',normalizationVersion:'2',response:{results:{H1:{ok:true,symbol:'BTCUSD',candles:[...coarse,...hourly]}}}});
    expect(result.provenance.qualityReports[0].excludedCoarseRows).toBeGreaterThan(0);
    expect(result.provenance.qualityReports[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'COARSE_PREFIX_EXCLUDED'})]));
  });
  it('marca OHLC corrupto como inválido',()=>{
    const result=buildMt5DatasetBundle({symbol:'BTCUSD',instrumentId:'CRYPTO_BTC_USD',assetClass:'CRYPTO',timeframes:['M5'],processingTimestamp:'2026-01-01T12:00:00Z',normalizationVersion:'1',response:{results:{M5:{ok:true,symbol:'BTCUSD',candles:[bar('2026-01-01T11:00:00Z',{high:98})]}}}});
    expect(result.provenance.qualityStatus).toBe('DATA_INVALID');
  });
});
