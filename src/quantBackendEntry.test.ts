import{describe,expect,it}from'vitest';
import{runTrustedParameterStability,runTrustedQuantBacktest,runTrustedQuantStage,validateTrustedQuantPreparation,type TrustedQuantBacktestInput}from'./quantBackendEntry';
import{createDefaultQuantLaboratoryConfig}from'./quantLaboratoryModel';
import type{StoredQuantDataset}from'./quantBacktestRunner';

const durations=[86_400_000,14_400_000,3_600_000,900_000,300_000];
const series=Object.fromEntries(['D1','H4','H1','M15','M5'].map((timeframe,index)=>[timeframe,Array.from({length:80},(_,row)=>({time:new Date(Date.UTC(2025,0,1)+row*durations[index]).toISOString(),open:100+row*.01,high:101+row*.01,low:99+row*.01,close:100.5+row*.01,spread:1}))]));
const dataset:StoredQuantDataset={provenance:{datasetId:'D-TRUST',provider:'MT5',instrumentId:'FX_EURUSD',symbol:'EURUSD',assetClass:'FOREX',timezone:'UTC',pointSize:.01,tickSize:.01,dateFrom:'2025-01-01',dateTo:'2025-03-21',resolution:'MULTI_TIMEFRAME',rows:400,checksum:'trusted-checksum',qualityStatus:'DATA_VALID',qualityReportId:'Q-1'},raw:{schemaVersion:2,provider:'MT5',symbol:'EURUSD',instrumentId:'FX_EURUSD',assetClass:'FOREX',processingTimestamp:'2026-01-01T00:00:00Z',pointSize:.01,tickSize:.01,series}};
const input:TrustedQuantBacktestInput={experimentId:'Q-TRUST',datasetId:'D-TRUST',dataset,config:createDefaultQuantLaboratoryConfig(),now:'2026-01-01T00:00:00Z'};

describe('trusted Quant backend entry',()=>{
  it('recalcula desde dataset/config e ignora resultados manipulados del renderer',()=>{
    const clean=runTrustedQuantBacktest(input),manipulated=runTrustedQuantBacktest({...input,result:{netR:999999},records:[{setupId:'FAKE'}],statistics:{sampleSize:999}} as TrustedQuantBacktestInput);
    expect(manipulated).toEqual(clean);
    expect(manipulated).toMatchObject({authority:'SENTINEL_BACKEND_V1',executionAuthorized:false,datasetChecksum:'trusted-checksum'});
    expect(manipulated.output.partition).toMatchObject({scope:'DEVELOPMENT_ONLY',oosSealed:true});
    expect(manipulated.output.records.every(record=>Date.parse(record.sourceTimestamp)<Date.parse(manipulated.output.partition.developmentCutoff))).toBe(true);
    expect(manipulated.output.result.netR).not.toBe(999999);
  });
  it('rechaza una identidad durable BTC/EUR incompatible antes de calcular',()=>{
    const btc={provenance:{...dataset.provenance,instrumentId:'CRYPTO_BTCUSD',symbol:'BTCUSD',assetClass:'CRYPTO'},raw:{...dataset.raw,instrumentId:'CRYPTO_BTCUSD',symbol:'BTCUSD',assetClass:'CRYPTO'}};
    expect(()=>runTrustedQuantBacktest({...input,dataset:btc})).toThrow(/experimento declara FOREX/);
  });
  it('prepare falla antes de crear experimento si el rango no contiene todas las temporalidades',()=>{
    const config={...input.config,dateFrom:'2025-12-01',dateTo:'2025-12-31'};
    expect(()=>validateTrustedQuantPreparation({dataset,config})).toThrow(/no contiene D1/);
  });
  it('recalcula OOS en backend e ignora output renderer manipulado',()=>{
    const trusted={...input,stage:'OUT_OF_SAMPLE' as const},clean=runTrustedQuantStage(trusted),manipulated=runTrustedQuantStage({...trusted,output:{status:'COMPLETED',outOfSample:{statistics:{expectancyR:999}}}} as typeof trusted);
    expect(manipulated).toEqual(clean);
    expect(manipulated).toMatchObject({authority:'SENTINEL_BACKEND_V1',stage:'OUT_OF_SAMPLE',executionAuthorized:false});
  });
  it('mantiene rolling como diagnóstico no elegible y bloquea etapas desconocidas',()=>{
    expect(()=>runTrustedQuantStage({...input,stage:'WALK_FORWARD'})).toThrow(/WALK_FORWARD_BLOCKED/);
    expect(()=>runTrustedQuantStage({...input,stage:'FAKE'} as never)).toThrow(/no soportada/);
  });
  it.each(['OUT_OF_SAMPLE','MONTE_CARLO','BENCHMARK','ROBUSTNESS','ABLATION_PLAN','ABLATION_RUN','ABLATION_VALIDATION'] as const)('recalcula %s sin aceptar output del renderer',(stage)=>{
    const trusted={...input,stage},clean=runTrustedQuantStage(trusted),manipulated=runTrustedQuantStage({...trusted,output:{status:'COMPLETED',tradeAuthorized:true,statistics:{expectancyR:999_999}},records:[{setupId:'FAKE'}]} as typeof trusted);
    expect(manipulated).toEqual(clean);
    expect(manipulated).toMatchObject({authority:'SENTINEL_BACKEND_V1',stage,executionAuthorized:false});
    expect(JSON.stringify(manipulated)).not.toContain('999999');
    expect(JSON.stringify(manipulated)).not.toContain('FAKE');
  });
  it('parameter-stability usa fronteras temporales congeladas e ignora payload renderer',()=>{
    const clean=runTrustedParameterStability({...input,datasetReuseCount:1}),manipulated=runTrustedParameterStability({...input,datasetReuseCount:1,output:{runs:[{expectancy:999}]}} as TrustedQuantBacktestInput&{datasetReuseCount:number});
    expect(manipulated).toEqual(clean);
    expect(manipulated).toMatchObject({authority:'SENTINEL_BACKEND_V1',stage:'PARAMETER_STABILITY',executionAuthorized:false});
  });
});
