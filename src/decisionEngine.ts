import type { MultiTimeframeAnalysis } from './multiTimeframeAnalysis';
import { assessEventRisk, type EventAction } from './eventRisk';
import type { EnrichedNews } from './newsIntelligence';
import type { IntermarketAnalysis } from './intermarketEngine';
import type { InstitutionalFactorRisk } from './institutionalFactorRisk';
import type { MicrostructureAnalysis } from './microstructureEngine';
import {
  isConservativeRiskOnAsset,
  type VixContextAnalysis,
  type VixRegime,
  type VixTrend,
} from './vixContext';

export type GuardedDecision = 'BUY_CONDICIONADO' | 'SELL_CONDICIONADO' | 'ESPERAR' | 'NO_OPERAR_EVENTO';
export type VixDecisionInfluence = 'SIN_VOTO' | 'REFERENCIA' | 'PENALIZA_CORROBORADO';
export interface DecisionVolatilityContext {
  value: number | null;
  regime: VixRegime | 'SIN_DATOS';
  trend: VixTrend;
  freshness: 'VIGENTE' | 'DESACTUALIZADO' | 'SIN_DATOS';
  observedAt: string | null;
  influence: VixDecisionInfluence;
  confidencePenalty: number;
  ruleVersion: string | null;
}
export interface DecisionResult {
  decision: GuardedDecision;
  confidence: number;
  technicalConfidence: number;
  eventAction: EventAction;
  reasons: string[];
  volatilityContext: DecisionVolatilityContext;
  blockingEvent?: MacroEvent;
}
export const NO_VIX_DECISION_CONTEXT: DecisionVolatilityContext = Object.freeze({
  value: null,
  regime: 'SIN_DATOS',
  trend: 'INSUFICIENTE',
  freshness: 'SIN_DATOS',
  observedAt: null,
  influence: 'SIN_VOTO',
  confidencePenalty: 0,
  ruleVersion: null,
});

const normalized = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const US_INDEX_SYMBOLS = new Set([
  'SPX', 'SP500', 'US500', 'US500CASH', 'SPY',
  'NDX', 'NASDAQ100', 'NAS100', 'US100', 'US100CASH', 'QQQ',
  'DJI', 'DJ30', 'US30', 'US30CASH',
  'RUT', 'RUSSELL2000', 'US2000', 'IWM',
]);

export function eventRelevantToSymbol(event: MacroEvent, symbol: string) {
  const key = normalized(symbol), currency = event.currency.toUpperCase();
  if (key.includes(currency)) return true;
  if (currency === 'USD' && ['XAU', 'GOLD', 'NAS', 'USTEC', 'US100', 'SPX', 'BTC', 'ETH'].some(item => key.includes(item))) return true;
  if (currency === 'EUR' && ['DAX', 'GER40', 'STOXX'].some(item => key.includes(item))) return true;
  if (currency === 'CNY' && ['XAU', 'COPPER', 'AUD', 'HANG', 'HK50'].some(item => key.includes(item))) return true;
  return false;
}

function vixPenaltyFor(
  symbol: string,
  technical: MultiTimeframeAnalysis,
  intermarket: IntermarketAnalysis | undefined,
  vix: VixContextAnalysis | undefined,
) {
  const stressed = Boolean(
    vix?.usableAsContext
      && ['ALTO', 'EXTREMO'].includes(vix.regime ?? '')
      && vix.trend === 'SUBIENDO',
  );
  const independentlyConfirmed = Boolean(
    intermarket?.fresh
      && intermarket.bias === 'BAJISTA'
      && technical.bias === 'ALCISTA',
  );
  if (!stressed || !independentlyConfirmed || !isConservativeRiskOnAsset(symbol)) return 0;
  const key = normalized(symbol);
  return US_INDEX_SYMBOLS.has(key) ? 10 : 5;
}

function decisionVolatilityContext(
  vix: VixContextAnalysis | undefined,
  penalty = 0,
): DecisionVolatilityContext {
  const freshness: DecisionVolatilityContext['freshness'] = !vix?.available
    ? 'SIN_DATOS'
    : vix.fresh
      ? 'VIGENTE'
      : 'DESACTUALIZADO';
  return {
    value: vix?.currentLevel ?? null,
    regime: vix?.regime ?? 'SIN_DATOS',
    trend: vix?.trend ?? 'INSUFICIENTE',
    freshness,
    observedAt: vix?.currentObservedAt ?? null,
    influence: penalty > 0 ? 'PENALIZA_CORROBORADO' : vix?.usableAsContext ? 'REFERENCIA' : 'SIN_VOTO',
    confidencePenalty: penalty,
    ruleVersion: vix?.ruleVersion ?? null,
  };
}

export function buildGuardedDecision(
  symbol: string,
  technical: MultiTimeframeAnalysis,
  events: MacroEvent[],
  now = new Date(),
  news: EnrichedNews[] = [],
  intermarket?: IntermarketAnalysis,
  institutional?: InstitutionalFactorRisk,
  micro?: MicrostructureAnalysis,
  vix?: VixContextAnalysis,
): DecisionResult {
  const relevant = events
    .filter(event => eventRelevantToSymbol(event, symbol))
    .map(event => ({ event, risk: assessEventRisk(event, now) }));
  const blocking = relevant.find(item => item.risk.action === 'BLOQUEAR_ENTRADAS');
  if (blocking) return {
    decision: 'NO_OPERAR_EVENTO',
    confidence: 0,
    technicalConfidence: technical.confidence,
    eventAction: blocking.risk.action,
    blockingEvent: blocking.event,
    volatilityContext: decisionVolatilityContext(vix),
    reasons: [
      `Evento de alto impacto: ${blocking.event.title} (${blocking.event.currency}).`,
      blocking.risk.reason,
      'El bloqueo macro prevalece sobre la señal técnica.',
    ],
  };

  const key = normalized(symbol);
  const relatedNews = news.filter(item => item.ageHours <= 24 && item.score >= 70 && item.assets.some(asset => {
    const candidate = normalized(asset);
    return key.includes(candidate)
      || candidate.includes(key)
      || ((key.includes('USD') || key.includes('XAU') || key.includes('BTC')) && candidate === 'USD');
  })).slice(0, 3);
  const intermarketConflict = Boolean(
    intermarket?.fresh
      && intermarket.bias !== 'NEUTRAL'
      && technical.bias !== 'NEUTRAL'
      && intermarket.bias !== technical.bias,
  );
  const microConflict = Boolean(
    micro?.fresh
      && micro.bias !== 'NEUTRAL'
      && ((technical.bias === 'ALCISTA' && micro.bias === 'VENDEDOR')
        || (technical.bias === 'BAJISTA' && micro.bias === 'COMPRADOR')),
  );
  const reducing = relevant.find(item => item.risk.action === 'REDUCIR_CONFIANZA');
  const institutionalPenalty = institutional?.fresh && institutional.level === 'ELEVADO'
    ? 20
    : institutional?.fresh && institutional.level === 'VIGILAR'
      ? 8
      : 0;
  const microPenalty = micro?.executionRisk === 'BLOQUEAR'
    ? 40
    : micro?.executionRisk === 'ELEVADO'
      ? 20
      : microConflict
        ? 10
        : 0;
  const vixPenalty = vixPenaltyFor(symbol, technical, intermarket, vix);
  const confidence = technical.confidence
    - (reducing ? 25 : 0)
    - (relatedNews.length ? 15 : 0)
    - (intermarketConflict ? 20 : 0)
    - institutionalPenalty
    - microPenalty
    - vixPenalty;
  const reasons = [`Sesgo técnico ${technical.bias.toLowerCase()} con alineación ${technical.alignment}%.`];
  if (reducing) reasons.push(`Confianza reducida por ${reducing.event.title} (${reducing.event.currency}).`);
  if (relatedNews.length) reasons.push(`Riesgo informativo elevado: ${relatedNews[0].title}`);
  if (intermarket?.fresh) reasons.push(`Contexto intermercado ${intermarket.bias.toLowerCase()} (${intermarket.score}).`);
  if (intermarketConflict) reasons.push('El contexto intermercado contradice la estructura técnica.');
  if (institutionalPenalty) reasons.push(...institutional!.reasons.slice(0, 2));
  if (microPenalty) reasons.push(...(micro?.warnings.slice(0, 2) ?? ['Microestructura desfavorable.']));
  if (vix?.usableAsContext) {
    reasons.push(`VIX diario ${vix.currentLevel?.toFixed(2)}: régimen ${vix.regime}, tendencia ${vix.trend.toLowerCase()} y tensión ${vix.score}/100.`);
  } else if (vix?.available) {
    reasons.push(`VIX diario sin voto: ${vix.reasons.find(reason => /insuficiente|atrasado|futuro/i.test(reason)) ?? 'contexto no utilizable'}`);
  }
  if (vixPenalty) {
    reasons.push(`Estrés VIX corroborado por intermercado bajista: ajuste prudencial de -${vixPenalty} puntos; VIX no decide la dirección.`);
  }
  if (technical.contradictions.length) reasons.push(...technical.contradictions);

  const volatilityContext = decisionVolatilityContext(vix, vixPenalty);
  if (technical.bias === 'NEUTRAL' || confidence < 45 || technical.alignment < 45 || micro?.executionRisk === 'BLOQUEAR') {
    return {
      decision: 'ESPERAR',
      confidence: Math.max(0, confidence),
      technicalConfidence: technical.confidence,
      eventAction: reducing?.risk.action ?? 'NORMAL',
      reasons,
      volatilityContext,
    };
  }
  return {
    decision: technical.bias === 'ALCISTA' ? 'BUY_CONDICIONADO' : 'SELL_CONDICIONADO',
    confidence: Math.max(0, confidence),
    technicalConfidence: technical.confidence,
    eventAction: reducing?.risk.action ?? 'NORMAL',
    reasons,
    volatilityContext,
  };
}
