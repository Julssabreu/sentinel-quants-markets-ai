import type { DecisionResult } from './decisionEngine';
import type { ModelGovernance } from './modelGovernance';
import type { TradePlan } from './tradePlan';

export type RecommendationStatus = 'RESEARCH_ONLY' | 'MANUAL_REVIEW' | 'BLOCKED';

export interface DecisionPosture {
  analyticalLabel: string;
  analyticalDecision: DecisionResult['decision'];
  analyticalConfidence: number;
  maturityStatus: ModelGovernance['status'];
  maturitySample: number;
  recommendationStatus: RecommendationStatus;
  recommendationAuthorized: boolean;
  executionStatus: 'DISABLED';
  executionAuthorized: false;
  simulationEligible: boolean;
  reasons: string[];
  summary: string;
}

export interface DecisionPostureInput {
  decision: DecisionResult;
  governance: ModelGovernance;
  plan: TradePlan;
  dataQualityValid: boolean;
  tickFresh: boolean;
  technicalReady: boolean;
  operationalMarketReady: boolean;
  additionalBlockers?: string[];
}

export function analyticalDecisionLabel(decision: DecisionResult['decision']) {
  if (decision === 'BUY_CONDICIONADO') return 'SESGO BUY';
  if (decision === 'SELL_CONDICIONADO') return 'SESGO SELL';
  if (decision === 'NO_OPERAR_EVENTO') return 'NO OPERAR POR EVENTO';
  return 'ESPERAR';
}

export function evaluateDecisionPosture(input: DecisionPostureInput): DecisionPosture {
  const { decision, governance, plan } = input;
  const directional = ['BUY_CONDICIONADO', 'SELL_CONDICIONADO'].includes(decision.decision);
  const evidenceBlockers = [
    !directional ? `La decisión analítica es ${decision.decision.replaceAll('_', ' ')}.` : null,
    !plan.active ? plan.cancellation[0] ?? 'No existe un plan simulado activo.' : null,
    !input.dataQualityValid ? 'La calidad del dataset no permite validar el escenario.' : null,
    !input.tickFresh ? 'La cotización operativa no está fresca.' : null,
    !input.technicalReady ? 'La identidad, las velas o la frescura no permiten una simulación técnica válida.' : null,
  ].filter((reason): reason is string => Boolean(reason));

  const simulationEligible = directional
    && plan.active
    && input.dataQualityValid
    && input.tickFresh
    && input.technicalReady;
  const operationalBlockers=[
    !input.operationalMarketReady ? 'La cobertura integral del mercado no está completa para una recomendación.' : null,
    ...(input.additionalBlockers ?? []),
  ].filter((reason):reason is string=>Boolean(reason));
  const recommendationReady=simulationEligible&&!operationalBlockers.length;
  const recommendationAuthorized = recommendationReady && governance.canVote && governance.status!=='SUSPENDED';
  const recommendationStatus: RecommendationStatus = !recommendationReady || governance.status==='SUSPENDED'
    ? 'BLOCKED'
    : governance.canVote
      ? 'MANUAL_REVIEW'
      : 'RESEARCH_ONLY';
  const reasons = [...evidenceBlockers,...operationalBlockers];
  if (!governance.canVote) {
    reasons.push(`Modelo ${governance.status.toLowerCase()}: ${governance.reasons[0]}`);
  }
  reasons.push('La ejecución automática está desactivada; Julio conserva la decisión final.');

  const analyticalLabel = analyticalDecisionLabel(decision.decision);
  const maturity = governance.status === 'RESEARCH'
    ? 'modelo en investigación'
    : governance.status === 'PROBATION'
      ? 'modelo en prueba'
      : governance.status === 'SUSPENDED'
        ? 'modelo suspendido'
        : 'modelo activo';
  const summary = `${analyticalLabel} ${decision.confidence}%; ${maturity}; no ejecutar automáticamente.`;

  return {
    analyticalLabel,
    analyticalDecision: decision.decision,
    analyticalConfidence: decision.confidence,
    maturityStatus: governance.status,
    maturitySample: governance.sample,
    recommendationStatus,
    recommendationAuthorized,
    executionStatus: 'DISABLED',
    executionAuthorized: false,
    simulationEligible,
    reasons,
    summary,
  };
}
