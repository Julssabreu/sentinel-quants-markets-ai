import type { DecisionResult, DecisionVolatilityContext } from './decisionEngine';
import type { MultiTimeframeAnalysis } from './multiTimeframeAnalysis';
import type { AtomicAssessment } from './atomicConsensus';
import type { TradePlan } from './tradePlan';
import type { EnrichedNews } from './newsIntelligence';
import type { DecisionPosture } from './decisionPosture';

export interface JulssbotMarketContext {
  market: string;
  marketLabel: string;
  canonicalId: string;
  contractId: string;
  instrumentKind: string;
  classificationConfidence: string;
  coverage: 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT';
  requiredRoleCount: number;
  plannedRoleCount: number;
  verifiedRoleCount: number;
  readyForTechnicalAnalysis: boolean;
  readyForOperationalAnalysis: boolean;
  operationalPriceVerified: boolean;
  activeSources: string[];
  pendingSources: string[];
  gaps: string[];
  warnings: string[];
}

export interface JulssbotContext {
  symbol: string;
  decision: DecisionResult;
  posture?: DecisionPosture;
  multi: MultiTimeframeAnalysis;
  atomic: AtomicAssessment;
  plan: TradePlan;
  news: EnrichedNews[];
  freshness: string;
  historyCount: number;
  sources: string[];
  /** Optional for backward-compatible history/tests; live consultations always include it. */
  market?: JulssbotMarketContext;
}

const line = (value: string) => `• ${value}`;

function postureSummary(context:JulssbotContext){
  return context.posture
    ? [
        line(context.posture.summary),
        line(`Autorización: ${context.posture.recommendationStatus.replaceAll('_',' ')} · ejecución ${context.posture.executionStatus}.`),
      ]
    : [line('Análisis consultivo; ejecución automática desactivada.')];
}

function vixInfluence(vix: DecisionVolatilityContext | undefined) {
  if (!vix || vix.value == null) {
    return 'VIX diario sin datos utilizables: no votó ni modificó la decisión.';
  }
  if (vix.influence === 'PENALIZA_CORROBORADO') {
    return `El estrés del VIX coincidió con evidencia independiente y restó ${vix.confidencePenalty} puntos de confianza; no decidió la dirección.`;
  }
  if (vix.influence === 'REFERENCIA') {
    return 'Sentinel lo tomó como patrón de referencia de volatilidad, sin alterar por sí solo la confianza.';
  }
  return 'El VIX no emitió voto ni ajustó la confianza porque el contexto no era utilizable o no aplicaba.';
}

function vixSummary(vix: DecisionVolatilityContext | undefined) {
  if (!vix || vix.value == null) return `VIX diario: sin datos · ${vix?.freshness ?? 'SIN DATOS'}.`;
  return `VIX diario ${vix.value.toFixed(2)} · régimen ${vix.regime} · tendencia ${vix.trend} · ${vix.freshness}.`;
}

function marketSummary(context: JulssbotContext): string[] {
  const market = context.market;
  if (!market) return [line('Mercado: sin clasificación multimercado registrada para esta consulta.')];
  const coverage = market.coverage === 'COMPLETE'
    ? 'completa'
    : market.coverage === 'PARTIAL'
      ? 'parcial'
      : 'insuficiente';
  const result = [
    line(`Mercado ${market.marketLabel} (${market.market}) · ${market.instrumentKind} · cobertura ${coverage}.`),
    line(`Identidad canónica: ${market.canonicalId}.`),
    line(`Cobertura de funciones: ${market.verifiedRoleCount} verificadas, ${market.plannedRoleCount}/${market.requiredRoleCount} planificadas.`),
    line(market.operationalPriceVerified
      ? 'Precio operativo verificado en el instrumento resuelto por MT5.'
      : 'El precio operativo no quedó verificado para este instrumento.'),
    line(market.readyForOperationalAnalysis
      ? 'Cobertura operativa lista según el enrutador.'
      : market.readyForTechnicalAnalysis
        ? 'Lectura técnica habilitada; el análisis operativo completo sigue bloqueado.'
        : 'Lectura técnica operativa bloqueada hasta verificar identidad, contrato, velas y frescura.'),
  ];
  if (market.gaps.length) result.push(line(`Coberturas pendientes: ${market.gaps.join('; ')}.`));
  if (market.pendingSources.length) result.push(line(`Fuentes pendientes de configuración/licencia: ${market.pendingSources.join(', ')}.`));
  if (market.market === 'STOCK' && market.gaps.some(gap => /fundamental|regulator/i.test(gap))) {
    result.push(line('La lectura de esta acción no debe presentarse como análisis fundamental completo hasta cubrir documentos corporativos y regulatorios.'));
  }
  return result;
}

export function answerJulssbot(question: string, context: JulssbotContext) {
  const q = question.toLowerCase();
  const contrary = context.multi.bias === 'ALCISTA' ? 'bajista' : context.multi.bias === 'BAJISTA' ? 'alcista' : 'direccional';
  const vix = context.decision.volatilityContext;
  const simulatedPlanAvailable=context.plan.active&&(context.posture?.simulationEligible??true);

  if (q.includes('mercado') || q.includes('cobertura') || q.includes('fuente')) return [
    `Cobertura multimercado para ${context.symbol}:`,
    ...marketSummary(context),
    `Fuentes verificadas en esta consulta: ${context.sources.length ? context.sources.join(', ') : 'ninguna'}.`,
    'Una fuente configurada no se declara como dato usado hasta que responde y aporta evidencia verificable.',
  ].join('\n');

  if (q.includes('vix') || q.includes('volatilidad')) return [
    `Contexto de volatilidad para ${context.symbol}:`,
    line(vixSummary(vix)),
    line(vixInfluence(vix)),
    vix?.observedAt ? line(`Observación diaria: ${vix.observedAt}.`) : line('No hay una observación diaria registrada.'),
    'El VIX es contexto de riesgo: nunca es una señal BUY/SELL, no abre operaciones y no decide por sí solo.',
  ].join('\n');

  if (q.includes('contrario') || q.includes('salir mal')) return [
    `Escenario contrario para ${context.symbol}:`,
    line(`La tesis ${context.multi.bias.toLowerCase()} pierde fuerza si las temporalidades rápidas cambian antes que H4–D1.`),
    line(`Actualmente hay ${context.multi.contradictions.length} contradicciones y alineación de ${context.multi.alignment}%.`),
    line(context.atomic.reason),
    line(simulatedPlanAvailable && context.plan.stop ? `Invalidación cuantitativa simulada: ${context.plan.stop}.` : 'No existe una invalidación simulada válida con la evidencia disponible.'),
    `No asumiré que el escenario ${contrary} es válido hasta que cambie la estructura.`,
  ].join('\n');

  if (q.includes('atomic')) return [
    `Atomic Analyst MT5: ${context.atomic.agreement}.`,
    context.atomic.reason,
    context.atomic.signal ? `Última señal: ${context.atomic.signal.type} · ${context.atomic.signal.symbol} · ${context.atomic.signal.timeframe}.` : 'No hay una señal legible para este contexto.',
    'Atomic es evidencia secundaria y no sustituye los controles de riesgo.',
  ].join('\n');

  if (q.includes('noticia') || q.includes('macro')) return context.news.length ? [
    `Noticias relevantes para ${context.symbol}:`,
    ...context.news.slice(0, 5).map((item) => line(`${item.impact} · ${item.title} · ${item.source}`)),
    'Los titulares modifican la incertidumbre; no fijan por sí solos la dirección.',
  ].join('\n') : `No encontré noticias recientes clasificadas para ${context.symbol}. Esto no demuestra ausencia de riesgo.`;

  if (q.includes('plan') || q.includes('entrada') || q.includes('stop')) return simulatedPlanAvailable ? [
    `${context.symbol} · PLAN SIMULADO · ${context.decision.decision.replaceAll('_', ' ')}`,
    ...postureSummary(context),
    line(`Activación: ${context.plan.trigger}`),
    line(`Precio máximo: ${context.plan.maxEntry}`),
    line(`Stop/invalidation: ${context.plan.stop}`),
    line(`TP1: ${context.plan.tp1} · TP2: ${context.plan.tp2}`),
    line(`Caduca en ${context.plan.expiresAfterBars} velas.`),
    'Este plan sirve para seguimiento y aprendizaje. No autoriza una operación; debe cancelarse si la cotización deja de estar fresca o aparece un evento bloqueante.',
  ].join('\n') : `${context.symbol}: no existe un plan simulado válido. ${context.posture?.reasons.join(' ')??context.decision.reasons.join(' ')}`;

  return [
    `${context.symbol} · ${context.decision.decision.replaceAll('_', ' ')}`,
    ...postureSummary(context),
    ...marketSummary(context),
    line(`Confianza analítica: ${context.decision.confidence}/100.`),
    line(`Sesgo ${context.multi.bias.toLowerCase()}, alineación ${context.multi.alignment}% y cobertura ${context.multi.available}/21.`),
    line(context.freshness),
    line(context.atomic.reason),
    line(vixSummary(vix)),
    line(vixInfluence(vix)),
    ...context.decision.reasons.slice(0, 4).map(line),
    line(`${context.historyCount} análisis anteriores registrados para este activo.`),
    `Fuentes usadas: ${context.sources.join(', ')}.`,
  ].join('\n');
}
