import { createGovernedAblationPlan } from './ablationGovernance';
import { calculateQuantStatistics } from './quantStatistics';
import { runPreparedSmcBacktest, type StoredQuantDataset } from './quantBacktestRunner';
import type { QuantLaboratoryConfig } from './quantLaboratoryModel';

export function runExecutableSmcAblations(input:{parentExperimentId:string;datasetId:string;dataset:StoredQuantDataset;config:QuantLaboratoryConfig;now:string}){
  const plan=createGovernedAblationPlan({familyId:`SMC_ABLATION:${input.parentExperimentId}`,experimentId:input.parentExperimentId,createdAt:input.now,createdBy:'SENTINEL_USER',datasetReuseCount:1});
  const executable=plan.variants.filter(variant=>variant.readiness==='EXECUTABLE');
  const baseline=runPreparedSmcBacktest({...input,experimentId:`${input.parentExperimentId}:ABLATION:BASELINE`});
  const baselineStats=calculateQuantStatistics(baseline.result.trades.map(trade=>trade.netResultR));
  const runs=executable.map(variant=>{
    const researchOptions={enabledComponents:{FVG:variant.removed!=='FVG',M5_CONFIRMATION:variant.removed!=='M5_CONFIRMATION'}};
    const output=runPreparedSmcBacktest({...input,experimentId:`${input.parentExperimentId}:ABLATION:WITHOUT_${variant.removed}`,researchOptions});
    const statistics=calculateQuantStatistics(output.result.trades.map(trade=>trade.netResultR));
    return{variantId:variant.variantId,removed:variant.removed,status:'COMPLETED' as const,statistics,expectancyDeltaR:statistics.expectancyR==null||baselineStats.expectancyR==null?null:statistics.expectancyR-baselineStats.expectancyR,profitFactorDelta:statistics.profitFactor==null||baselineStats.profitFactor==null?null:statistics.profitFactor-baselineStats.profitFactor,records:output.records,result:output.result};
  });
  return{status:'COMPLETED' as const,parentExperimentId:input.parentExperimentId,datasetId:input.datasetId,baseline:{statistics:baselineStats,records:baseline.records,result:baseline.result},runs,blocked:plan.variants.filter(variant=>variant.readiness!=='EXECUTABLE'&&variant.removed!=null).map(variant=>({variantId:variant.variantId,removed:variant.removed,readiness:variant.readiness,reasonCodes:variant.reasonCodes})),featureSetVersion:plan.featureSetVersion,automaticPromotion:false as const};
}
