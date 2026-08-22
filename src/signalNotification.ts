import type { DecisionResult } from './decisionEngine';
import type { TradePlan } from './tradePlan';
import type { AtomicAssessment } from './atomicConsensus';
import type { DecisionPosture } from './decisionPosture';

export interface SignalNotificationCandidate {
  symbol:string; timeframe:string; decision:DecisionResult; plan:TradePlan;
  atomic:AtomicAssessment; checkedAt:string; riskPercent:number;
}

const price=(value:number|null)=>value==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value);

export function formatDecisionPostureLines(posture:DecisionPosture){
  return [
    `Decisión analítica: *${posture.analyticalLabel} ${posture.analyticalConfidence}%*`,
    `Madurez: modelo ${posture.maturityStatus} · ${posture.maturitySample}/30`,
    'Autorización: *{{VERDICT}}*',
    'Consulta Julssbot: {{AI}}',
    `Ejecución: ${posture.executionStatus}`,
  ];
}

export function formatSimulatedPlanLine(
  posture:DecisionPosture,
  plan:TradePlan,
  label='PLAN SIMULADO',
){
  if(!posture.simulationEligible||!plan.active){
    return `${label} NO VÁLIDO: ${posture.reasons[0]??plan.cancellation[0]??'evidencia insuficiente'}`;
  }
  return `${label}: entrada ${price(plan.trigger)} · máxima ${price(plan.maxEntry)} · invalidación/SL ${price(plan.stop)} · TP1 ${price(plan.tp1)} · TP2 ${price(plan.tp2)} · caduca en ${plan.expiresAfterBars} vela(s)`;
}

export function signalFingerprint(candidate:SignalNotificationCandidate){
  const p=candidate.plan,v=candidate.decision.volatilityContext;
  return [candidate.symbol,candidate.timeframe,candidate.decision.decision,p.direction,p.trigger,p.stop,p.tp1,p.tp2,candidate.atomic.agreement,candidate.atomic.signal?.id,candidate.atomic.signal?.time,'VIX',v.value,v.regime,v.trend,v.freshness,v.observedAt,v.influence,v.confidencePenalty,v.ruleVersion].join('|');
}

export function isActionableSignal(candidate:SignalNotificationCandidate,minConfidence=60){
  return candidate.plan.active&&
    ['BUY_CONDICIONADO','SELL_CONDICIONADO'].includes(candidate.decision.decision)&&
    candidate.decision.confidence>=minConfidence&&
    !['CONTRADICE','CONFLICTO','DESACTUALIZADO','OTRO_CONTEXTO'].includes(candidate.atomic.agreement)&&
    candidate.plan.trigger!=null&&candidate.plan.stop!=null&&candidate.plan.tp1!=null&&candidate.plan.tp2!=null;
}

export function formatSignalNotification(candidate:SignalNotificationCandidate){
  const {decision,plan,atomic}=candidate;
  const icon=plan.direction==='BUY'?'🟢':'🔴';
  const rr=plan.riskReward2==null?'—':`1:${plan.riskReward2.toFixed(2)}`;
  const vix=decision.volatilityContext;
  const vixValue=vix.value==null?'sin datos':vix.value.toFixed(2);
  const vixPenalty=vix.confidencePenalty>0?` · ajuste corroborado -${vix.confidencePenalty} pts`:'';
  return [
    `${icon} *SENTINEL · ${candidate.symbol} ${candidate.timeframe}*`,
    `Decisión: *${decision.decision.replaceAll('_',' ')}*`,
    `Entrada/trigger: ${price(plan.trigger)}`,
    `Entrada máxima: ${price(plan.maxEntry)}`,
    `Stop Loss: ${price(plan.stop)}`,
    `TP1: ${price(plan.tp1)}`,
    `TP2: ${price(plan.tp2)}`,
    `Riesgo/beneficio TP2: ${rr}`,
    `Confianza protegida: ${decision.confidence}%`,
    `VIX diario (contexto, no señal): ${vixValue} · ${vix.regime} · ${vix.trend} · ${vix.freshness}${vixPenalty}`,
    `Riesgo sugerido: ${candidate.riskPercent}%`,
    `Atomic: ${atomic.agreement}${atomic.signal?` ${atomic.signal.type}`:''}`,
    `Caducidad: ${plan.expiresAfterBars} vela(s)`,
    `Hora RD: ${new Date(candidate.checkedAt).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo'})}`,
    '',
    'Orden no ejecutada. Verifica precio, spread y riesgo antes de operar.'
  ].join('\n');
}
