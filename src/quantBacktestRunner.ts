import type { Candle } from './analysisEngine';
import type { DataQualityStatus } from './dataQualityEngine';
import type { ExecutionCostProfile } from './executionCostModel';
import { classifyMarket, type MarketClass } from './marketArchitecture';
import { calculateQuantStatistics } from './quantStatistics';
import { createQuantSetupRecord, type QuantSetupRecord } from './quantSetupRecord';
import { runSmcQuantBacktest, type SmcBacktestResult } from './smcQuantBacktester';
import { analyzeSmcStrategy, type SmcResearchOptions, type SmcTimeframeProfile } from './smcStrategy';
import type { QuantLaboratoryConfig } from './quantLaboratoryModel';
import { timeframeDurationMs } from './multiTimeframeSynchronizer';

export interface StoredQuantDataset {
  provenance: QuantDatasetSummary & {
    qualityReports?:Array<{timeframe:string;status:DataQualityStatus}>;
    broker?:string|null; exchange?:string|null; timezone?:string;
    pointSize?:number|null; tickSize?:number|null;
  };
  raw: {
    schemaVersion:1|2; provider:string; symbol:string; instrumentId:string; assetClass:string;
    processingTimestamp:string; series:Record<string,Candle[]>; pointSize?:number|null; tickSize?:number|null;
  };
}

const MARKET_MAP: Record<QuantLaboratoryConfig['assetClass'], MarketClass> = {
  FOREX:'FOREX', INDEX:'INDEX', EQUITY:'STOCK', METAL:'METAL', ENERGY:'COMMODITY', CRYPTO:'CRYPTO', FUTURE:'FUTURE',
};
const DAY_MS=86_400_000;
const normalizeAssetClass=(value:string):MarketClass=>value==='EQUITY'?'STOCK':value==='ENERGY'?'COMMODITY':value as MarketClass;
const withoutBrokerSuffix=(value:string)=>value.trim().toUpperCase().replace(/(?:\.(?:M|PRO|RAW|ECN|I)|_(?:PRO|RAW|ECN))$/,'');

function canonicalIdentity(symbol:string,assetClass:MarketClass){
  const marketHint=assetClass as Exclude<MarketClass,'UNKNOWN'>;
  return classifyMarket({symbol:withoutBrokerSuffix(symbol),marketHint}).canonicalId;
}

export function validateQuantDatasetConfig(dataset:StoredQuantDataset,config:QuantLaboratoryConfig){
  const {provenance,raw}=dataset;
  const expectedAsset=MARKET_MAP[config.assetClass],provenanceAsset=normalizeAssetClass(provenance.assetClass),rawAsset=normalizeAssetClass(raw.assetClass);
  if(raw.instrumentId!==provenance.instrumentId||raw.symbol!==provenance.symbol)throw new Error('Datos brutos y procedencia no coinciden.');
  if(rawAsset!==provenanceAsset)throw new Error(`Clase de activo inconsistente entre datos brutos (${raw.assetClass}) y procedencia (${provenance.assetClass}).`);
  if(!provenance.timezone||provenance.timezone==='BROKER_SERVER_UNVERIFIED')throw new Error('El dataset no tiene una zona horaria verificada; investigación Quant bloqueada.');
  if(provenance.pointSize!=null&&raw.pointSize!=null&&provenance.pointSize!==raw.pointSize)throw new Error('pointSize inconsistente entre datos brutos y procedencia.');
  if(provenance.tickSize!=null&&raw.tickSize!=null&&provenance.tickSize!==raw.tickSize)throw new Error('tickSize inconsistente entre datos brutos y procedencia.');
  if(provenanceAsset!==expectedAsset)throw new Error(`El dataset ${provenance.symbol} es ${provenance.assetClass}, pero el experimento declara ${config.assetClass}.`);
  const configuredIdentity=canonicalIdentity(config.symbol,expectedAsset),datasetIdentity=canonicalIdentity(provenance.symbol,provenanceAsset);
  if(configuredIdentity!==datasetIdentity)throw new Error(`El símbolo configurado ${config.symbol} no coincide con el dataset ${provenance.symbol}.`);
  return{instrumentId:provenance.instrumentId,symbol:provenance.symbol,assetClass:expectedAsset,canonicalId:datasetIdentity};
}

function utcDay(value:string,field:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error(`${field} debe usar YYYY-MM-DD.`);
  const parsed=Date.parse(`${value}T00:00:00.000Z`);
  if(!Number.isFinite(parsed))throw new Error(`${field} inválido.`);
  return parsed;
}

export function filterQuantSeriesByDate(series:Record<string,Candle[]>,dateFrom:string,dateTo:string){
  const from=utcDay(dateFrom,'dateFrom'),toDay=utcDay(dateTo,'dateTo'),toExclusive=toDay+DAY_MS;
  if(from>=toDay)throw new Error('Rango temporal Quant inválido.');
  const filtered=Object.fromEntries(Object.entries(series).map(([timeframe,bars])=>[
    timeframe,bars.filter(bar=>{const time=Date.parse(bar.time);return Number.isFinite(time)&&time>=from&&time<toExclusive;}),
  ]));
  return{
    series:filtered,
    dateRange:{from:new Date(from).toISOString(),toExclusive:new Date(toExclusive).toISOString()},
    rowsByTimeframe:Object.fromEntries(Object.entries(filtered).map(([timeframe,bars])=>[timeframe,bars.length])),
  };
}

export function inferPointSize(candles:readonly Candle[]){
  const prices=[...new Set(candles.slice(0,2000).flatMap(bar=>[bar.open,bar.high,bar.low,bar.close])
    .filter(value=>Number.isFinite(value)&&value>0).map(value=>Number(value.toFixed(10))))].sort((a,b)=>a-b);
  let minimum=Infinity;
  for(let index=1;index<prices.length;index++){
    const delta=prices[index]-prices[index-1];
    if(delta>Math.max(1e-10,prices[index]*1e-10)&&delta<minimum)minimum=delta;
  }
  return Number.isFinite(minimum)?Number(minimum.toPrecision(8)):null;
}

export interface QuantExecutionSummary extends ExecutionCostProfile {
  costModel:'PER_BAR_HISTORICAL_SPREAD_OR_BPS';
  spreadSource:'HISTORICAL_POINTS'|'CONFIGURED_BPS';
  historicalSpreadUsed:boolean;
  pointSize:number|null;
  spreadBps:number;
  slippageBps:number;
  commissionBps:number;
}

export function resolveSmcResearchOptions(config:QuantLaboratoryConfig,researchOptions?:SmcResearchOptions):SmcResearchOptions{
  return{...researchOptions,parameters:{minimumRR:config.risk.minimumRR,...researchOptions?.parameters}};
}

export function runPreparedSmcBacktest(input:{ experimentId:string; datasetId:string; dataset:StoredQuantDataset; config:QuantLaboratoryConfig; now:string; researchOptions?:SmcResearchOptions }) {
  const { provenance, raw } = input.dataset;
  if (provenance.datasetId !== input.datasetId) throw new Error('El dataset cargado no coincide con el experimento.');
  if (provenance.qualityStatus === 'DATA_INVALID') throw new Error('DATA_INVALID no puede ejecutarse.');
  const identity=validateQuantDatasetConfig(input.dataset,input.config);
  const profile:SmcTimeframeProfile={id:`SMC_${Object.values(input.config.timeframes).join('_')}_RESEARCH`,...input.config.timeframes};
  const required=Object.values(input.config.timeframes),filtered=filterQuantSeriesByDate(raw.series,input.config.dateFrom,input.config.dateTo);
  for(const timeframe of required)if(!filtered.series[timeframe]?.length)throw new Error(`El dataset no contiene ${timeframe} dentro de ${input.config.dateFrom}–${input.config.dateTo}.`);
  const asOf=Date.parse(input.now);
  if(!Number.isFinite(asOf))throw new Error('El backtest requiere un reloj de cálculo válido.');
  for(const timeframe of required)for(const bar of filtered.series[timeframe]){
    const opened=Date.parse(bar.time);
    if(opened+timeframeDurationMs(timeframe)>asOf)throw new Error(`El dataset contiene una vela ${timeframe} no cerrada al momento del cálculo.`);
  }
  const trigger=filtered.series[profile.trigger],referencePrice=trigger[0].open;
  const observedDateRange={from:new Date(Date.parse(trigger[0].time)).toISOString(),toExclusive:new Date(Date.parse(trigger.at(-1)!.time)+timeframeDurationMs(profile.trigger)).toISOString()};
  if(!Number.isFinite(referencePrice)||referencePrice<=0)throw new Error('Precio de referencia inválido.');
  const pointSize=provenance.pointSize??raw.pointSize??null;
  const historicalSpreadUsed=pointSize!=null&&trigger.some(bar=>Number.isFinite(bar.spread)&&bar.spread!>=0);
  const executionForBar=(bar:Candle,index:number):ExecutionCostProfile=>{
    const price=Number.isFinite(bar.open)&&bar.open>0?bar.open:bar.close;
    const historicalSpread=pointSize!=null&&Number.isFinite(bar.spread)&&bar.spread!>=0?bar.spread!*pointSize:null;
    return{
      id:`LAB_DYNAMIC_${index}`,
      spreadPrice:historicalSpread??price*input.config.execution.spreadBps/10_000,
      slippagePrice:price*input.config.execution.slippageBps/10_000,
      commissionRoundTripPrice:price*input.config.execution.commissionBps/10_000,
      latencyMs:0,conservativeSameBar:true,
    };
  };
  const qualities=Object.fromEntries(required.map(timeframe=>[timeframe,provenance.qualityReports?.find(report=>report.timeframe===timeframe)?.status??provenance.qualityStatus]));
  const datasetIds=Object.fromEntries(required.map(timeframe=>[timeframe,input.datasetId]));
  const baseline=executionForBar(trigger[0],0);
  const execution:QuantExecutionSummary={
    ...baseline,id:`LAB_PER_BAR_${input.config.execution.spreadBps}_${input.config.execution.slippageBps}_${input.config.execution.commissionBps}`,
    costModel:'PER_BAR_HISTORICAL_SPREAD_OR_BPS',spreadSource:historicalSpreadUsed?'HISTORICAL_POINTS':'CONFIGURED_BPS',historicalSpreadUsed,pointSize,
    spreadBps:input.config.execution.spreadBps,slippageBps:input.config.execution.slippageBps,commissionBps:input.config.execution.commissionBps,
  };
  const researchOptions=resolveSmcResearchOptions(input.config,input.researchOptions);
  const result=runSmcQuantBacktest({
    experimentId:input.experimentId,datasetIds,dataQuality:qualities,frames:filtered.series,execution,executionForBar,profile,
    riskPercent:input.config.risk.riskPercent,analyze:(frames,currentProfile)=>analyzeSmcStrategy(frames,currentProfile,researchOptions),
    instrument:{instrumentId:identity.instrumentId,canonicalSymbol:identity.symbol,assetClass:identity.assetClass,provider:provenance.provider,broker:provenance.broker??null,exchange:provenance.exchange??null,timezone:provenance.timezone??'UTC',tickSize:provenance.tickSize??raw.tickSize??null,pointSize,contractSize:null},
  });
  const tradesBySetup=new Map(result.trades.map(trade=>[trade.setupId,trade]));
  const records:QuantSetupRecord[]=result.candidates.map(candidate=>createQuantSetupRecord({
    experimentId:input.experimentId,datasetIds,candidate,trade:tradesBySetup.get(candidate.setupId)??null,
    receivedTimestamp:candidate.signalTimestamp,processingTimestamp:input.now,createdAt:input.now,
    spread:candidate.signalSpreadPrice??execution.spreadPrice,slippage:candidate.signalSlippagePrice??execution.slippagePrice,
    riskPercent:input.config.risk.riskPercent,
  }));
  return{
    result,records,statistics:calculateQuantStatistics(result.trades.map(trade=>trade.netResultR)),execution,
    dateRange:filtered.dateRange,observedDateRange,rowsByTimeframe:filtered.rowsByTimeframe,
    appliedRisk:{riskPercent:input.config.risk.riskPercent,minimumRR:input.config.risk.minimumRR,model:'FIXED_FRACTION_NON_COMPOUNDED' as const},
  };
}

export type PreparedSmcBacktestOutput = ReturnType<typeof runPreparedSmcBacktest>;
export type { SmcBacktestResult };
