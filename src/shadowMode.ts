import type { Candle } from './analysisEngine';
import type { SentinelDecision } from './decisionContract';
import {
  evaluateExitOnBar,
  prepareExecutedTrade,
  type ExecutedTradePlan,
  type ExecutionCostProfile,
  type ExitReason,
} from './executionCostModel';

export type ShadowStatus = 'PENDING_ENTRY' | 'OPEN' | 'CLOSED' | 'BLOCKED';
export interface ShadowObservation {
  schemaVersion:2; shadowId:string; decision:SentinelDecision; receivedAt:string; latencyMs:number;
  wouldHaveEntered:boolean; plannedEntry:number|null; plannedStop:number|null; plannedTarget:number|null;
  theoreticalResultR:number|null; grossResultR:number|null; maeR:number|null; mfeR:number|null;
  status:ShadowStatus; executionProfileId:string|null; plan:ExecutedTradePlan|null; enteredAt:string|null;
  closedAt:string|null; exitReason:ExitReason|null; lastProcessedBarTime:string|null;
  feedStatuses:Record<string,string>; reasonCodes:string[]; liveOrderSent:false;
}
export interface ShadowEvent {
  schemaVersion:1; shadowEventId:string; shadowId:string;
  eventType:'CREATED'|'BAR_PROCESSED'|'RESOLVED'|'RECOVERY_BLOCKED';
  occurredAt:string; observation:ShadowObservation;
}

function timestamp(value:string, field:string) {
  const parsed=Date.parse(value);
  if(!Number.isFinite(parsed))throw new Error(`${field} inválido.`);
  return parsed;
}

export function createShadowObservation(decision:SentinelDecision,input:{receivedAt:string;latencyMs:number;feedStatuses:Record<string,string>}):ShadowObservation {
  timestamp(input.receivedAt,'receivedAt');
  if(!Number.isFinite(input.latencyMs)||input.latencyMs<0)throw new Error('latencyMs inválida.');
  const quantCanCollectEvidence=['RESEARCH','PROBATION','PRELIMINARY','ELIGIBLE'].includes(decision.quantStatus);
  const ready=decision.smcStatus==='SMC_VALID'&&quantCanCollectEvidence&&decision.riskStatus==='ACCEPTABLE'
    &&decision.direction!=null&&decision.entry!=null&&decision.stop!=null&&decision.target!=null;
  const evidenceReason=decision.quantStatus==='ELIGIBLE'?'SHADOW_LIVE_FORWARD':`SHADOW_${decision.quantStatus}_EVIDENCE_ONLY`;
  const recoveryReasons=decision.reasonCodes.includes('RECOVERY_GAP')?['RECOVERY_GAP','RECOVERY_GAP_NO_PERFORMANCE']:[];
  return{schemaVersion:2,shadowId:`SHADOW:${decision.setupId}:${decision.timestamp}`,decision:structuredClone(decision),receivedAt:input.receivedAt,latencyMs:input.latencyMs,wouldHaveEntered:ready,plannedEntry:decision.entry,plannedStop:decision.stop,plannedTarget:decision.target,theoreticalResultR:null,grossResultR:null,maeR:null,mfeR:null,status:ready?'PENDING_ENTRY':'BLOCKED',executionProfileId:null,plan:null,enteredAt:null,closedAt:null,exitReason:null,lastProcessedBarTime:null,feedStatuses:{...input.feedStatuses},reasonCodes:ready?[evidenceReason,'NO_LIVE_ORDER']:['SHADOW_DECISION_NOT_READY',...recoveryReasons,'NO_LIVE_ORDER'],liveOrderSent:false};
}

export function advanceShadowObservation(observation:ShadowObservation,bar:Candle,profile:ExecutionCostProfile):ShadowObservation {
  if(observation.status==='BLOCKED'||observation.status==='CLOSED')return structuredClone(observation);
  const current=timestamp(bar.time,'bar.time'),decisionAt=timestamp(observation.decision.timestamp,'decision.timestamp');
  const previous=observation.lastProcessedBarTime?timestamp(observation.lastProcessedBarTime,'lastProcessedBarTime'):null;
  if(previous!=null&&current===previous)return structuredClone(observation);
  if(previous!=null&&current<previous)throw new Error('Shadow rechazó una vela fuera de orden.');
  if(current<=decisionAt)throw new Error('Shadow no puede usar una vela anterior o igual a la decisión.');
  if(observation.executionProfileId&&observation.executionProfileId!==profile.id)throw new Error('El perfil Shadow no puede cambiar durante una observación.');
  const next=structuredClone(observation);next.lastProcessedBarTime=bar.time;next.executionProfileId=profile.id;
  if(next.status==='PENDING_ENTRY'){
    const{direction,stop,target}=next.decision;
    if(direction==null||stop==null||target==null)throw new Error('Decisión Shadow incompleta.');
    next.plan=prepareExecutedTrade(direction,bar.open,stop,target,profile);next.enteredAt=bar.time;next.status='OPEN';
  }
  const plan=next.plan;if(!plan)return next;
  const adverse=plan.direction==='LONG'?plan.entryFill-bar.low:bar.high-plan.entryFill;
  const favorable=plan.direction==='LONG'?bar.high-plan.entryFill:plan.entryFill-bar.low;
  next.maeR=Math.max(next.maeR??0,adverse/plan.riskPrice,0);next.mfeR=Math.max(next.mfeR??0,favorable/plan.riskPrice,0);
  const exit=evaluateExitOnBar(plan,bar,profile);
  if(exit){next.status='CLOSED';next.closedAt=bar.time;next.exitReason=exit.reason;next.grossResultR=exit.grossResultR;next.theoreticalResultR=exit.netResultR;next.reasonCodes=[...next.reasonCodes,`SHADOW_EXIT_${exit.reason}`]}
  return next;
}

export function blockShadowObservationForRecovery(observation:ShadowObservation):ShadowObservation {
  if(observation.status==='BLOCKED'||observation.status==='CLOSED')return structuredClone(observation);
  return{...structuredClone(observation),status:'BLOCKED',wouldHaveEntered:false,executionProfileId:null,plan:null,enteredAt:null,closedAt:null,exitReason:null,theoreticalResultR:null,grossResultR:null,maeR:null,mfeR:null,reasonCodes:[...new Set([...observation.reasonCodes,'RECOVERY_GAP','SHADOW_RECOVERY_GAP','RECOVERY_GAP_NO_PERFORMANCE'])],liveOrderSent:false};
}

export function resolveShadowObservation(observation:ShadowObservation,resultR:number,closedAt:string):ShadowObservation {
  if(observation.theoreticalResultR!=null)throw new Error('Shadow result es inmutable.');
  if(!observation.wouldHaveEntered)throw new Error('Una decisión bloqueada no puede convertirse en trade Shadow.');
  if(!Number.isFinite(resultR))throw new Error('Shadow result debe ser finito.');timestamp(closedAt,'closedAt');
  return{...observation,status:'CLOSED',theoreticalResultR:resultR,closedAt,reasonCodes:[...observation.reasonCodes,'SHADOW_EXTERNALLY_RESOLVED']};
}

export function createShadowEvent(eventType:ShadowEvent['eventType'],observation:ShadowObservation,occurredAt:string):ShadowEvent {
  timestamp(occurredAt,'occurredAt');
  const suffix=eventType==='CREATED'?'CREATED':eventType==='RECOVERY_BLOCKED'?`RECOVERY_BLOCKED:${occurredAt}`:observation.lastProcessedBarTime??occurredAt;
  return{schemaVersion:1,shadowEventId:`${observation.shadowId}:${eventType}:${suffix}`,shadowId:observation.shadowId,eventType,occurredAt,observation:structuredClone(observation)};
}
