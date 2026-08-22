import type { ExecutionCostProfile } from './executionCostModel';
import { marketEventLatency, type NormalizedMarketDataEvent } from './marketDataEvent';
import type { SentinelDecision } from './decisionContract';
import { reconstructShadowObservations } from './shadowCoordinator';
import { advanceShadowObservation, createShadowEvent, createShadowObservation, type ShadowEvent, type ShadowObservation } from './shadowMode';

export interface ShadowFeedHealth { status:'ONLINE'|'HEALTHY'|'DEGRADED'|'OFFLINE'; observedAt:string; }
export interface ShadowRuntimeResult { events:ShadowEvent[]; active:ShadowObservation[]; ignoredReason:string|null; }

const active = (value:ShadowObservation) => value.status==='PENDING_ENTRY'||value.status==='OPEN';

export function recoverActiveShadowObservations(events:ShadowEvent[]):ShadowObservation[] {
  return reconstructShadowObservations(events).filter(active);
}

export function startShadowDecision(
  decision:SentinelDecision,
  receivedAt:string,
  feedHealth:Record<string,ShadowFeedHealth>,
):ShadowEvent {
  const decisionAt=Date.parse(decision.timestamp),received=Date.parse(receivedAt);
  if(!Number.isFinite(decisionAt)||!Number.isFinite(received)||received<decisionAt)throw new Error('Timestamps Shadow inconsistentes.');
  const statuses=Object.fromEntries(Object.entries(feedHealth).map(([source,value])=>[source,value.status]));
  const observation=createShadowObservation(decision,{receivedAt:new Date(received).toISOString(),latencyMs:received-decisionAt,feedStatuses:statuses});
  return createShadowEvent('CREATED',observation,observation.receivedAt);
}

export function processShadowMarketEvent(
  journal:ShadowEvent[],
  event:NormalizedMarketDataEvent,
  profile:ExecutionCostProfile,
  feedHealth:Record<string,ShadowFeedHealth>,
):ShadowRuntimeResult {
  const observations=recoverActiveShadowObservations(journal);
  if(event.eventType!=='BAR'||!event.bar)return{events:[],active:observations,ignoredReason:'SHADOW_REQUIRES_BAR'};
  if(!event.bar.closed)return{events:[],active:observations,ignoredReason:'SHADOW_OPEN_BAR_REJECTED'};
  const eventTime=Date.parse(event.sourceTimestamp);
  const matching=observations.filter(item=>item.decision.instrumentId===event.instrumentId
    && eventTime>Date.parse(item.lastProcessedBarTime??item.decision.timestamp));
  if(!matching.length)return{events:[],active:observations,ignoredReason:'SHADOW_NO_ACTIVE_OBSERVATION'};
  const barClosedAt=typeof event.metadata?.barClosedAt==='string'?Date.parse(event.metadata.barClosedAt):Number.NaN;
  const measured=marketEventLatency(event),latency=Number.isFinite(barClosedAt)
    ? {...measured,totalMs:Math.max(0,Date.parse(event.processingTimestamp)-barClosedAt)}
    : measured;
  const statuses=Object.fromEntries(Object.entries(feedHealth).map(([source,value])=>[source,value.status]));
  statuses[event.source]=statuses[event.source]??'ONLINE';
  const emitted:ShadowEvent[]=[];
  for(const observation of matching){
    const updated={...observation,latencyMs:Math.max(observation.latencyMs,latency.totalMs),feedStatuses:{...observation.feedStatuses,...statuses}};
    const next=advanceShadowObservation(updated,{time:event.sourceTimestamp,open:event.bar.open,high:event.bar.high,low:event.bar.low,close:event.bar.close},profile);
    if(next.lastProcessedBarTime!==observation.lastProcessedBarTime)emitted.push(createShadowEvent(next.status==='CLOSED'?'RESOLVED':'BAR_PROCESSED',next,event.processingTimestamp));
  }
  const combined=reconstructShadowObservations([...journal,...emitted]).filter(active);
  return{events:emitted,active:combined,ignoredReason:null};
}
