import { calculateQuantStatistics } from './quantStatistics';
import type { QuantSetupRecord } from './quantSetupRecord';
import { createDevelopmentWalkForward } from './quantValidationRunner';
import type { runExecutableSmcAblations } from './challengerAblationRunner';

type AblationOutput=ReturnType<typeof runExecutableSmcAblations>;
const completed=(records:readonly QuantSetupRecord[])=>records.filter(record=>record.resultStatus==='COMPLETED'&&Number.isFinite(record.netResultR)).sort((a,b)=>Date.parse(a.sourceTimestamp)-Date.parse(b.sourceTimestamp));

function fixedPartition(records:readonly QuantSetupRecord[],boundaries:{trainingEnd:string|null;oosStart:string|null},purgeMs:number){
  const rows=completed(records),trainingEnd=boundaries.trainingEnd?Date.parse(boundaries.trainingEnd):Number.NaN,oosStart=boundaries.oosStart?Date.parse(boundaries.oosStart):Number.NaN;
  if(!Number.isFinite(trainingEnd)||!Number.isFinite(oosStart))return{status:'INSUFFICIENT_DATA' as const,training:[],validation:[],outOfSample:[],purged:rows};
  const start=(row:QuantSetupRecord)=>Date.parse(row.sourceTimestamp),end=(row:QuantSetupRecord)=>Math.max(start(row),Date.parse(row.exitTimestamp??row.sourceTimestamp));
  const training=rows.filter(row=>end(row)<trainingEnd-purgeMs),validation=rows.filter(row=>start(row)>trainingEnd+purgeMs&&end(row)<oosStart-purgeMs),outOfSample=rows.filter(row=>start(row)>oosStart+purgeMs),used=new Set([...training,...validation,...outOfSample].map(row=>row.setupId));
  return{status:'COMPLETED' as const,training,validation,outOfSample,purged:rows.filter(row=>!used.has(row.setupId))};
}

export function validateAblationChallengers(input:{ablation:AblationOutput;boundaries:{trainingEnd:string|null;oosStart:string|null};purgeMs:number}){
  const variants=[{variantId:'BASELINE',removed:null,records:input.ablation.baseline.records},...input.ablation.runs.map(run=>({variantId:run.variantId,removed:run.removed,records:run.records}))];
  const results=variants.map(variant=>{const partition=fixedPartition(variant.records,input.boundaries,input.purgeMs),oosIds=partition.outOfSample.map(record=>record.setupId),walkForward=createDevelopmentWalkForward(variant.records,oosIds);return{variantId:variant.variantId,removed:variant.removed,status:partition.status,purgedCount:partition.purged.length,training:{setupIds:partition.training.map(record=>record.setupId),statistics:calculateQuantStatistics(partition.training.map(record=>record.netResultR!))},validation:{setupIds:partition.validation.map(record=>record.setupId),statistics:calculateQuantStatistics(partition.validation.map(record=>record.netResultR!))},outOfSample:{setupIds:oosIds,statistics:calculateQuantStatistics(partition.outOfSample.map(record=>record.netResultR!))},walkForward}});
  const baseline=results[0];
  return{status:'COMPLETED' as const,parentExperimentId:input.ablation.parentExperimentId,boundaries:input.boundaries,purgeMs:input.purgeMs,results:results.map(result=>({...result,comparison:{oosExpectancyDeltaR:result.outOfSample.statistics.expectancyR==null||baseline.outOfSample.statistics.expectancyR==null?null:result.outOfSample.statistics.expectancyR-baseline.outOfSample.statistics.expectancyR,oosProfitFactorDelta:result.outOfSample.statistics.profitFactor==null||baseline.outOfSample.statistics.profitFactor==null?null:result.outOfSample.statistics.profitFactor-baseline.outOfSample.statistics.profitFactor,formalComparisonReady:result.outOfSample.statistics.sampleSize>=30&&result.walkForward.status==='COMPLETED'}})),automaticPromotion:false as const};
}
