import type { DecisionResult } from './decisionEngine';
import type { DecisionPosture } from './decisionPosture';
import { MODEL_MANIFEST, modelFingerprint, simulationFingerprint } from './modelGovernance';
import type { MultiTimeframeAnalysis } from './multiTimeframeAnalysis';
import type { MarketRouteSnapshot } from './marketSourceRouter';
import type { TradePlan } from './tradePlan';

interface DatasetQualitySummary {
  score:number;
  warnings:string[];
}

export interface AnalysisHistoryDraftInput {
  symbol:string;
  brokerSymbol:string;
  timeframe:string;
  anchorTime:string|null;
  decision:DecisionResult;
  posture:DecisionPosture;
  technical:MultiTimeframeAnalysis;
  plan:TradePlan;
  quality:DatasetQualitySummary;
  marketRoute?:MarketRouteSnapshot;
  sources:string[];
  strategy?:string;
  checkedAt?:string;
}

export function buildAnalysisHistoryDraft(
  input:AnalysisHistoryDraftInput,
):Omit<AnalysisHistoryRecord,'id'|'createdAt'|'schemaVersion'>{
  const simulationEligible=Boolean(input.posture.simulationEligible&&input.plan.active&&input.anchorTime);
  const strategy=input.strategy??'BREAKOUT_STRUCTURE_ATR';
  const analysisFingerprint=modelFingerprint({
    kind:'ANALYSIS',model:modelFingerprint(),brokerSymbol:input.brokerSymbol||input.symbol,
    timeframe:input.timeframe,anchor:input.anchorTime,strategy,
  });
  const simulationId=simulationEligible
    ? simulationFingerprint({
        symbol:input.symbol,
        brokerSymbol:input.brokerSymbol,
        timeframe:input.timeframe,
        simulationAnchorTime:input.anchorTime,
        strategy,
        plan:{...input.plan,mode:'SIMULATED'},
      })
    : undefined;
  return{
    legacySemantics:false,
    analysisFingerprint,
    symbol:input.symbol,
    brokerSymbol:input.brokerSymbol,
    timeframe:input.timeframe,
    decision:input.decision.decision,
    confidence:input.decision.confidence,
    analyticalDecision:input.decision.decision,
    analyticalConfidence:input.decision.confidence,
    maturityStatus:input.posture.maturityStatus,
    maturitySample:input.posture.maturitySample,
    recommendationStatus:input.posture.recommendationStatus,
    recommendationAuthorized:input.posture.recommendationAuthorized,
    executionStatus:'DISABLED',
    executionAuthorized:false,
    simulationEligible,
    simulationFingerprint:simulationId,
    simulationAnchorTime:simulationEligible?input.anchorTime:null,
    planMode:simulationEligible?'SIMULATION':null,
    authorizationReasons:input.posture.reasons,
    technicalConfidence:input.decision.technicalConfidence,
    alignment:input.technical.alignment,
    eventAction:input.decision.eventAction,
    blockingEvent:input.decision.blockingEvent?.title??null,
    regime:input.technical.bias,
    strategy,
    modelId:MODEL_MANIFEST.modelId,
    modelVersion:MODEL_MANIFEST.version,
    modelFingerprint:modelFingerprint(),
    dataCheckedAt:input.checkedAt??new Date().toISOString(),
    dataQualityScore:input.quality.score,
    dataWarnings:input.quality.warnings,
    marketRoute:input.marketRoute,
    volatilityContext:input.decision.volatilityContext,
    plan:simulationEligible?{
      direction:input.plan.direction,
      trigger:input.plan.trigger,
      maxEntry:input.plan.maxEntry,
      stop:input.plan.stop,
      tp1:input.plan.tp1,
      tp2:input.plan.tp2,
      expiresAfterBars:input.plan.expiresAfterBars,
      mode:'SIMULATED',
    }:null,
    sources:[...new Set(input.sources.filter(Boolean))],
    outcome:null,
  };
}
