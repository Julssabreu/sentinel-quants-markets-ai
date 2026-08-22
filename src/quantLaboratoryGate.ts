import type { DataQualityStatus } from './dataQualityEngine';
import type { QuantStatistics } from './quantStatistics';

export type LaboratoryQuantStatus='RESEARCH'|'PROBATION'|'PRELIMINARY'|'ELIGIBLE'|'BLOCKED';
export interface LaboratoryGateThresholds{researchMinimum:number;probationMinimum:number;eligibleMinimum:number;minimumExpectancyR:number;minimumProfitFactor:number;maximumDrawdownR:number;minimumOosExpectancyR:number;minimumOosProfitFactor:number;minimumSampleQuality:number;maximumRuinProbability:number;}
export const DEFAULT_LABORATORY_GATE_THRESHOLDS:LaboratoryGateThresholds=Object.freeze({researchMinimum:30,probationMinimum:100,eligibleMinimum:250,minimumExpectancyR:0,minimumProfitFactor:1.2,maximumDrawdownR:12,minimumOosExpectancyR:0,minimumOosProfitFactor:1.1,minimumSampleQuality:60,maximumRuinProbability:.05});
export interface LaboratoryGateEvidence{statistics:QuantStatistics;oos:QuantStatistics;walkForwardStable:boolean;monteCarlo:{completed:boolean;ruinProbability:number|null};robustness:{completed:boolean;collapsedScenarios:number|null};sampleQuality:number;dataQuality:DataQualityStatus;paperTradingStable:boolean;shadowStable:boolean;}

export function evaluateLaboratoryQuantGate(evidence:LaboratoryGateEvidence,thresholds:LaboratoryGateThresholds=DEFAULT_LABORATORY_GATE_THRESHOLDS){
  const sample=evidence.statistics.sampleSize,reasonCodes:string[]=[];
  if(evidence.dataQuality==='DATA_INVALID'){reasonCodes.push('DATA_INVALID');return{status:'BLOCKED' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if(evidence.dataQuality==='DATA_DEGRADED'){reasonCodes.push('DATA_DEGRADED');return{status:'BLOCKED' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if(evidence.dataQuality==='DATA_WARNING')reasonCodes.push('DATA_WARNING_REVIEW_REQUIRED');
  if(sample<thresholds.researchMinimum){reasonCodes.push('QUANT_INSUFFICIENT_SAMPLE');return{status:'RESEARCH' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if((evidence.statistics.expectancyR??Number.NEGATIVE_INFINITY)<=thresholds.minimumExpectancyR){reasonCodes.push('QUANT_NEGATIVE_EXPECTANCY');return{status:'BLOCKED' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if((evidence.statistics.profitFactor??0)<1){reasonCodes.push('QUANT_PROFIT_FACTOR_FAILED');return{status:'BLOCKED' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if(evidence.statistics.maxDrawdownR>thresholds.maximumDrawdownR){reasonCodes.push('QUANT_DRAWDOWN_FAILED');return{status:'BLOCKED' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if(sample<thresholds.probationMinimum){reasonCodes.push('QUANT_PROBATION_SAMPLE');return{status:'PROBATION' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes}}
  if(sample<thresholds.eligibleMinimum)reasonCodes.push('QUANT_PRELIMINARY_SAMPLE');
  if((evidence.statistics.profitFactor??0)<thresholds.minimumProfitFactor)reasonCodes.push('QUANT_PROFIT_FACTOR_FAILED');
  if((evidence.oos.expectancyR??Number.NEGATIVE_INFINITY)<=thresholds.minimumOosExpectancyR)reasonCodes.push('QUANT_OOS_FAILED');
  if((evidence.oos.profitFactor??0)<thresholds.minimumOosProfitFactor)reasonCodes.push('QUANT_OOS_PF_FAILED');
  if(!evidence.walkForwardStable)reasonCodes.push('QUANT_WALK_FORWARD_FAILED');
  if(!evidence.monteCarlo.completed)reasonCodes.push('QUANT_MONTE_CARLO_MISSING');else if((evidence.monteCarlo.ruinProbability??1)>thresholds.maximumRuinProbability)reasonCodes.push('QUANT_RUIN_RISK_FAILED');
  if(!evidence.robustness.completed)reasonCodes.push('QUANT_ROBUSTNESS_MISSING');else if((evidence.robustness.collapsedScenarios??1)>0)reasonCodes.push('QUANT_ROBUSTNESS_FAILED');
  if(evidence.sampleQuality<thresholds.minimumSampleQuality)reasonCodes.push('QUANT_SAMPLE_QUALITY_LOW');
  if(!evidence.paperTradingStable)reasonCodes.push('QUANT_PAPER_FAILED');
  if(!evidence.shadowStable)reasonCodes.push('QUANT_SHADOW_FAILED');
  if(reasonCodes.length)return{status:'PRELIMINARY' as const,edgeValidated:false,tradeAuthorized:false as const,reasonCodes};
  return{status:'ELIGIBLE' as const,edgeValidated:true,tradeAuthorized:false as const,reasonCodes:['QUANT_ELIGIBLE_FOR_RISK_REVIEW']};
}
