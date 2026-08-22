import { evaluateRecordedParameterStability } from './ablationGovernance';
import { calculateQuantStatistics } from './quantStatistics';
import { runPreparedSmcBacktest, type StoredQuantDataset } from './quantBacktestRunner';
import type { QuantLaboratoryConfig } from './quantLaboratoryModel';
import { dataMiningRisk } from './researchGovernance';
import type { SmcResearchOptions } from './smcStrategy';

export const SMC_PARAMETER_REGIONS=Object.freeze({h4ZoneATR:[1.2,1.35,1.5,1.65,1.8],m5DisplacementATR:[.4,.475,.55,.625,.7],minimumRR:[1.2,1.35,1.5,1.65,1.8]});
type ParameterName=keyof typeof SMC_PARAMETER_REGIONS;

function developmentDataset(dataset:StoredQuantDataset,oosStart:string):StoredQuantDataset{const boundary=Date.parse(oosStart);if(!Number.isFinite(boundary))throw new Error('Frontera OOS inválida.');return{provenance:dataset.provenance,raw:{...dataset.raw,series:Object.fromEntries(Object.entries(dataset.raw.series).map(([frame,bars])=>[frame,bars.filter(bar=>Date.parse(bar.time)<boundary)]))}}}

export function runSmcParameterStability(input:{parentExperimentId:string;datasetId:string;dataset:StoredQuantDataset;config:QuantLaboratoryConfig;boundaries:{trainingEnd:string|null;oosStart:string|null};purgeMs:number;now:string;datasetReuseCount:number}){
  if(!input.boundaries.trainingEnd||!input.boundaries.oosStart)throw new Error('Estabilidad requiere fronteras Training/OOS congeladas.');
  const dataset=developmentDataset(input.dataset,input.boundaries.oosStart),trainingEnd=Date.parse(input.boundaries.trainingEnd),oosStart=Date.parse(input.boundaries.oosStart),runs=[] as Array<{parameter:ParameterName;value:number;experimentId:string;training:ReturnType<typeof calculateQuantStatistics>;validation:ReturnType<typeof calculateQuantStatistics>;records:ReturnType<typeof runPreparedSmcBacktest>['records']}>;
  for(const [parameter,values] of Object.entries(SMC_PARAMETER_REGIONS) as Array<[ParameterName,readonly number[]]>)for(const value of values){const experimentId=`${input.parentExperimentId}:PARAM:${parameter}:${value}`,researchOptions:SmcResearchOptions={parameters:{[parameter]:value}},output=runPreparedSmcBacktest({experimentId,datasetId:input.datasetId,dataset,config:input.config,now:input.now,researchOptions}),start=(record:(typeof output.records)[number])=>Date.parse(record.sourceTimestamp),end=(record:(typeof output.records)[number])=>Math.max(start(record),Date.parse(record.exitTimestamp??record.sourceTimestamp)),training=output.records.filter(record=>end(record)<trainingEnd-input.purgeMs),validation=output.records.filter(record=>start(record)>trainingEnd+input.purgeMs&&end(record)<oosStart-input.purgeMs),returns=(rows:typeof output.records)=>rows.map(record=>record.netResultR).filter((value):value is number=>value!=null&&Number.isFinite(value));runs.push({parameter,value,experimentId,training:calculateQuantStatistics(returns(training)),validation:calculateQuantStatistics(returns(validation)),records:output.records})}
  const regions=(Object.keys(SMC_PARAMETER_REGIONS) as ParameterName[]).map(parameter=>{const points=runs.filter(run=>run.parameter===parameter).map(run=>({value:run.value,expectancyR:run.validation.expectancyR})).filter((point):point is {value:number;expectancyR:number}=>point.expectancyR!=null);return{parameter,points,evaluation:evaluateRecordedParameterStability(points)}});
  return{status:'COMPLETED' as const,parentExperimentId:input.parentExperimentId,datasetId:input.datasetId,oosAccessed:false,oosBoundary:input.boundaries.oosStart,variantsTested:runs.length,dataMiningRisk:dataMiningRisk(runs.length,input.datasetReuseCount),runs,regions,automaticParameterChange:false as const};
}
