import type { Candle } from './analysisEngine';
import { runRandomSameRrBenchmark } from './benchmarkEngine';
import type { ExecutionCostProfile } from './executionCostModel';
import { runMonteCarloBootstrap } from './monteCarloEngine';
import type { QuantSetupRecord } from './quantSetupRecord';
import { evaluateRobustness } from './robustnessEngine';

const completed=(records:readonly QuantSetupRecord[],ids:readonly string[])=>{const selected=new Set(ids);return records.filter(record=>selected.has(record.setupId)&&record.resultStatus==='COMPLETED'&&Number.isFinite(record.netResultR)).sort((a,b)=>Date.parse(a.sourceTimestamp)-Date.parse(b.sourceTimestamp))};

export function runOosMonteCarlo(records:readonly QuantSetupRecord[],oosIds:readonly string[],config={paths:3000,randomSeed:20260816,ruinThresholdR:20}){
  const returns=completed(records,oosIds).map(record=>record.netResultR!);
  if(returns.length<5)return{status:'INSUFFICIENT_DATA' as const,sampleSize:returns.length,result:null};
  return{status:'COMPLETED' as const,sampleSize:returns.length,result:runMonteCarloBootstrap(returns,{...config,pathLength:returns.length})};
}

export function runOosSameRrBenchmark(input:{records:readonly QuantSetupRecord[];oosIds:readonly string[];candles:readonly Candle[];execution:ExecutionCostProfile;randomSeed:number;fallbackRR:number}){
  const records=completed(input.records,input.oosIds),from=records[0]?.sourceTimestamp,to=records.at(-1)?.exitTimestamp??records.at(-1)?.sourceTimestamp;
  const candles=from&&to?input.candles.filter(bar=>Date.parse(bar.time)>=Date.parse(from)&&Date.parse(bar.time)<=Date.parse(to)):[];
  const rrValues=records.map(record=>record.plannedRR).filter((value):value is number=>Number.isFinite(value)&&value!>0),rewardRisk=rrValues.length?rrValues.reduce((sum,value)=>sum+value,0)/rrValues.length:input.fallbackRR;
  if(records.length<1||candles.length<20)return{status:'INSUFFICIENT_DATA' as const,sampleSize:records.length,rewardRisk,result:null};
  const dynamic=input.execution as ExecutionCostProfile&Partial<{costModel:string;pointSize:number|null;spreadBps:number;slippageBps:number;commissionBps:number}>;
  const executionForBar=dynamic.costModel==='PER_BAR_HISTORICAL_SPREAD_OR_BPS'?(bar:Candle,index:number):ExecutionCostProfile=>{const price=bar.open>0?bar.open:bar.close,historical=dynamic.pointSize!=null&&Number.isFinite(bar.spread)&&bar.spread!>=0?bar.spread!*dynamic.pointSize:null;return{id:`BENCHMARK_BAR_${index}`,spreadPrice:historical??price*(dynamic.spreadBps??0)/10_000,slippagePrice:price*(dynamic.slippageBps??0)/10_000,commissionRoundTripPrice:price*(dynamic.commissionBps??0)/10_000,latencyMs:0,conservativeSameBar:true}}:undefined;
  return{status:'COMPLETED' as const,sampleSize:records.length,rewardRisk,result:runRandomSameRrBenchmark({candles,tradeCount:records.length,rewardRisk,atrMultiple:1,execution:input.execution,executionForBar,randomSeed:input.randomSeed,warmupBars:15}),costModel:executionForBar?'PER_BAR_HISTORICAL_SPREAD_OR_BPS' as const:'STATIC' as const};
}

export function runOosCostRobustness(records:readonly QuantSetupRecord[],oosIds:readonly string[],execution:ExecutionCostProfile){
  const selected=completed(records,oosIds),baseline=selected.map(record=>record.netResultR!);
  if(baseline.length<5)return{status:'INSUFFICIENT_DATA' as const,sampleSize:baseline.length,scenarios:[]};
  const adjusted=(spreadMultiplier:number,slippageMultiplier:number)=>selected.map(record=>{const risk=Math.abs((record.actualEntry??record.entry??0)-(record.stop??0));if(!Number.isFinite(risk)||risk<=0)return Number.NaN;const extra=(record.spread??execution.spreadPrice)*(spreadMultiplier-1)+(record.slippage??execution.slippagePrice)*2*(slippageMultiplier-1);return record.netResultR!-extra/risk});
  const scenarios=[{id:'SPREAD_2X',returns:adjusted(2,1)},{id:'SLIPPAGE_3X',returns:adjusted(1,3)},{id:'REMOVE_EVERY_10TH',returns:baseline.filter((_,index)=>(index+1)%10!==0)}];
  return{status:'COMPLETED' as const,sampleSize:baseline.length,scenarios:evaluateRobustness(baseline,scenarios)};
}
