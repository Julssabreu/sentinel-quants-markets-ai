import type { QuantGateStatus } from './quantSmcGate';
import type { SentinelQuantVersions } from './sentinelQuantVersions';

export type SmcDecisionStatus='NO_SETUP'|'SMC_CANDIDATE'|'SMC_VALID';
export type RiskDecisionStatus='NOT_EVALUATED'|'ACCEPTABLE'|'BLOCKED';
export type ExecutionDecisionStatus='ANALYSIS_ONLY'|'HEALTHY'|'BLOCKED';
export type FinalDecisionStatus='NO_SETUP'|'SMC_CANDIDATE'|'SMC_VALID'|'QUANT_RESEARCH'|'QUANT_PROBATION'|'QUANT_PRELIMINARY'|'QUANT_ELIGIBLE'|'QUANT_BLOCKED'|'RISK_BLOCKED'|'READY_TO_PRESENT'|'DATA_ERROR'|'SYSTEM_ERROR';
export interface SentinelDecision {
  schemaVersion:1; setupId:string; instrumentId:string; timestamp:string;
  smcStatus:SmcDecisionStatus; quantStatus:QuantGateStatus; riskStatus:RiskDecisionStatus; executionStatus:ExecutionDecisionStatus;
  direction:'LONG'|'SHORT'|null; entry:number|null; stop:number|null; target:number|null; plannedRR:number|null;
  quantMetrics:Record<string,number|null>; reasonCodes:string[]; versions:SentinelQuantVersions; finalStatus:FinalDecisionStatus;
}

export function deriveFinalStatus(input:Pick<SentinelDecision,'smcStatus'|'quantStatus'|'riskStatus'|'executionStatus'>):FinalDecisionStatus{
  if(input.smcStatus==='NO_SETUP')return'NO_SETUP';
  if(input.smcStatus==='SMC_CANDIDATE')return'SMC_CANDIDATE';
  if(input.quantStatus==='BLOCKED')return'QUANT_BLOCKED';
  if(input.quantStatus!=='ELIGIBLE')return `QUANT_${input.quantStatus}` as FinalDecisionStatus;
  if(input.riskStatus==='BLOCKED')return'RISK_BLOCKED';
  return input.riskStatus==='ACCEPTABLE'&&input.executionStatus!=='BLOCKED'?'READY_TO_PRESENT':'SMC_VALID';
}
