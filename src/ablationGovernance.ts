import { analyzeParameterStability } from './robustnessEngine';
import { createSmcAblationPlan, type SmcAblationComponent } from './smcAblationPlan';
import { dataMiningRisk } from './researchGovernance';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';
import type { QuantModelRegistryEntry } from './quantModelRegistry';

export type AblationReadiness='BASELINE_REFERENCE'|'EXECUTABLE'|'REQUIRES_CHALLENGER_RUNNER'|'COMPONENT_NOT_IN_CHAMPION';
export interface AblationCapability{component:SmcAblationComponent;toggleImplemented:boolean;partOfCurrentChampion:boolean;reasonCode:string;}
export const CURRENT_SMC_ABLATION_CAPABILITIES:readonly AblationCapability[]=[
  {component:'STRUCTURE_BREAK',toggleImplemented:false,partOfCurrentChampion:true,reasonCode:'ABLATION_STRUCTURE_COUPLED_TO_SWEEP'},
  {component:'LIQUIDITY_SWEEP',toggleImplemented:false,partOfCurrentChampion:true,reasonCode:'ABLATION_SWEEP_COUPLED_TO_DISPLACEMENT'},
  {component:'FVG',toggleImplemented:true,partOfCurrentChampion:true,reasonCode:'ABLATION_FVG_CAUSAL_TOGGLE_AVAILABLE'},
  {component:'ORDER_BLOCK',toggleImplemented:false,partOfCurrentChampion:false,reasonCode:'ABLATION_ORDER_BLOCK_NOT_IN_CHAMPION'},
  {component:'M5_CONFIRMATION',toggleImplemented:true,partOfCurrentChampion:true,reasonCode:'ABLATION_M5_CAUSAL_TOGGLE_AVAILABLE'},
] as const;

export function createGovernedAblationPlan(input:{familyId:string;experimentId:string;createdAt:string;createdBy:string;datasetReuseCount:number}){
  const variants=createSmcAblationPlan(input.familyId).map(variant=>{
    if(variant.removed==null)return{...variant,readiness:'BASELINE_REFERENCE' as const,reasonCodes:['ABLATION_BASELINE_EXISTING_RESULT'],automaticPromotion:false as const};
    const capability=CURRENT_SMC_ABLATION_CAPABILITIES.find(item=>item.component===variant.removed);
    if(!capability)throw new Error(`Capacidad de ablación no registrada: ${variant.removed}`);
    const readiness:AblationReadiness=!capability.partOfCurrentChampion?'COMPONENT_NOT_IN_CHAMPION':capability.toggleImplemented?'EXECUTABLE':'REQUIRES_CHALLENGER_RUNNER';
    return{...variant,readiness,reasonCodes:[capability.reasonCode],automaticPromotion:false as const};
  });
  const models:QuantModelRegistryEntry[]=variants.slice(1).map(variant=>({schemaVersion:1,modelId:`MODEL:${variant.variantId}`,version:variant.featureSetVersion,type:'FEATURE_SET',status:'CHALLENGER',createdAt:input.createdAt,createdBy:input.createdBy,experimentIds:[input.experimentId],validationStatus:{backtest:false,oos:false,walkForward:false,paper:false,shadow:false},promotionStatus:'NOT_REQUESTED',performanceSummary:{expectancyR:null,profitFactor:null,maxDrawdownR:null},knownLimitations:variant.reasonCodes,versions:SENTINEL_QUANT_VERSIONS}));
  return{familyId:input.familyId,featureSetVersion:variants[0].featureSetVersion,variants,models,variantsTested:0,variantsPlanned:variants.length,dataMiningRisk:dataMiningRisk(variants.length,input.datasetReuseCount),championMutationAllowed:false as const};
}

export function evaluateRecordedParameterStability(points:readonly{value:number;expectancyR:number}[]){if(points.length<5||new Set(points.map(point=>point.value)).size<3)return{status:'INSUFFICIENT_DATA' as const,points:points.length,result:null};return{status:'COMPLETED' as const,points:points.length,result:analyzeParameterStability(points)}}
