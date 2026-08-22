import { completedQuantRecords } from './quantSegmentation';
import { calculateQuantStatistics } from './quantStatistics';
import type { QuantSetupRecord } from './quantSetupRecord';
import { runRollingWalkForward } from './quantValidation';

const fnv=(value:string)=>{let hash=0x811c9dc5;for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,0x01000193)}return(hash>>>0).toString(16).padStart(8,'0')};
const ordered=(records:readonly QuantSetupRecord[])=>completedQuantRecords(records).sort((a,b)=>Date.parse(a.sourceTimestamp)-Date.parse(b.sourceTimestamp));
const startMs=(record:QuantSetupRecord)=>Date.parse(record.sourceTimestamp);
const endMs=(record:QuantSetupRecord)=>Math.max(startMs(record),Date.parse(record.exitTimestamp??record.sourceTimestamp));

export interface PurgedValidationConfig{trainingRatio:number;validationRatio:number;purgeMs:number;range?:{from:string;toExclusive:string}}
export function createPurgedChronologicalValidation(records:readonly QuantSetupRecord[],config:PurgedValidationConfig={trainingRatio:.6,validationRatio:.2,purgeMs:0}){
  if(config.trainingRatio<=0||config.validationRatio<0||config.trainingRatio+config.validationRatio>=1||config.purgeMs<0)throw new Error('Configuración cronológica inválida.');
  const rows=ordered(records),rangeStart=config.range?Date.parse(config.range.from):Number.NaN,rangeEnd=config.range?Date.parse(config.range.toExclusive):Number.NaN;
  if(config.range&&(!Number.isFinite(rangeStart)||!Number.isFinite(rangeEnd)||rangeStart>=rangeEnd))throw new Error('Rango temporal de validación inválido.');
  const firstIndex=Math.floor(rows.length*config.trainingRatio),secondIndex=Math.floor(rows.length*(config.trainingRatio+config.validationRatio)),span=rangeEnd-rangeStart;
  const firstBoundary=config.range?rangeStart+span*config.trainingRatio:rows[firstIndex]?.sourceTimestamp?Date.parse(rows[firstIndex].sourceTimestamp):null;
  const secondBoundary=config.range?rangeStart+span*(config.trainingRatio+config.validationRatio):rows[secondIndex]?.sourceTimestamp?Date.parse(rows[secondIndex].sourceTimestamp):null;
  const training=firstBoundary==null?[]:rows.filter(row=>endMs(row)<firstBoundary-config.purgeMs);
  const validation=firstBoundary==null||secondBoundary==null?[]:rows.filter(row=>startMs(row)>firstBoundary+config.purgeMs&&endMs(row)<secondBoundary-config.purgeMs);
  const outOfSample=secondBoundary==null?[]:rows.filter(row=>startMs(row)>secondBoundary+config.purgeMs);
  const used=new Set([...training,...validation,...outOfSample].map(row=>row.setupId)),purged=rows.filter(row=>!used.has(row.setupId));
  const lockSource=outOfSample.map(row=>`${row.setupId}|${row.sourceTimestamp}|${row.exitTimestamp??''}|${row.netResultR}`).join('\n');
  return {status:rows.length?'COMPLETED' as const:'INSUFFICIENT_DATA' as const,totalCompleted:rows.length,purgeMs:config.purgeMs,purgedCount:purged.length,boundaries:{trainingEnd:firstBoundary==null?null:new Date(firstBoundary).toISOString(),oosStart:secondBoundary==null?null:new Date(secondBoundary).toISOString()},training:{setupIds:training.map(row=>row.setupId),statistics:calculateQuantStatistics(training.map(row=>row.netResultR!))},validation:{setupIds:validation.map(row=>row.setupId),statistics:calculateQuantStatistics(validation.map(row=>row.netResultR!))},outOfSample:{setupIds:outOfSample.map(row=>row.setupId),lockId:`OOS-FNV1A-${fnv(lockSource)}`,sealed:true as const,selectionMethod:'CHRONOLOGICAL_HOLDOUT_WITH_INTERVAL_PURGE' as const,developmentAccessAllowed:false as const,statistics:calculateQuantStatistics(outOfSample.map(row=>row.netResultR!))}};
}

export function createDevelopmentWalkForward(records:readonly QuantSetupRecord[],oosSetupIds:readonly string[],config?:{trainSize?:number;testSize?:number;stepSize?:number;purgeSize?:number}){
  const locked=new Set(oosSetupIds),development=ordered(records).filter(row=>!locked.has(row.setupId)),returns=development.map(row=>row.netResultR!);
  const trainSize=config?.trainSize??Math.max(20,Math.floor(returns.length*.5)),testSize=config?.testSize??Math.max(5,Math.floor(returns.length*.2)),stepSize=config?.stepSize??Math.max(5,Math.floor(returns.length*.1)),purgeSize=config?.purgeSize??2;
  const methodology={kind:'ROLLING_PERFORMANCE_STABILITY' as const,parameterRefit:false as const,modelRetrainedPerFold:false as const,claim:'DIAGNOSTIC_ONLY_NOT_TRAIN_TEST_WALK_FORWARD' as const};
  if(returns.length<trainSize+testSize+purgeSize)return{status:'INSUFFICIENT_DATA' as const,developmentSample:returns.length,oosExcluded:locked.size,config:{trainSize,testSize,stepSize,purgeSize},methodology,validation:null};
  const diagnostic=runRollingWalkForward(returns,{trainSize,testSize,stepSize,purgeSize});
  return{status:'COMPLETED' as const,developmentSample:returns.length,oosExcluded:locked.size,config:{trainSize,testSize,stepSize,purgeSize},methodology,validation:{...diagnostic,diagnosticStable:diagnostic.stable,stable:Boolean(false)}};
}
