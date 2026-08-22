import { describe, expect, it } from 'vitest';
import { answerJulssbot, type JulssbotContext } from './julssbotAnalysis';
import { NO_VIX_DECISION_CONTEXT } from './decisionEngine';

const context = {
  symbol: 'EUR/USD',
  decision: {
    decision: 'ESPERAR', confidence: 30, technicalConfidence: 55, eventAction: 'NORMAL',
    reasons: ['Contradicción.'], volatilityContext: NO_VIX_DECISION_CONTEXT,
  },
  multi: { score: 0, confidence: 55, alignment: 40, bias: 'NEUTRAL', available: 21, bullish: [], bearish: [], neutral: [], contradictions: ['Cruce'], results: [] },
  atomic: { agreement: 'SIN_DATOS', signal: null, reason: 'Sin enlace.', advisoryDecision: null },
  plan: { active: false, direction: null, trigger: null, maxEntry: null, stop: null, tp1: null, tp2: null, riskReward1: null, riskReward2: null, atr: null, expiresAfterBars: 0, cancellation: ['Esperar.'] },
  news: [], freshness: 'Cotización fresca.', historyCount: 2, sources: ['MT5'],
  market: {
    market: 'FOREX', marketLabel: 'Divisas', canonicalId: 'FOREX:EUR/USD', contractId: 'FOREX:EUR/USD',
    instrumentKind: 'SPOT', classificationConfidence: 'EXACT', coverage: 'PARTIAL',
    requiredRoleCount: 4, plannedRoleCount: 4, verifiedRoleCount: 1,
    readyForTechnicalAnalysis: true, readyForOperationalAnalysis: false,
    operationalPriceVerified: true, activeSources: ['MetaTrader 5'], pendingSources: ['TradingView'],
    gaps: [], warnings: [],
  },
} as unknown as JulssbotContext;

describe('julssbot grounded answers', () => {
  it('explica sin inventar entrada', () => expect(answerJulssbot('dame una entrada', context)).toContain('no existe un plan simulado válido'));
  it('declara ausencia de noticias', () => expect(answerJulssbot('qué noticias hay', context)).toContain('No encontré'));
  it('explica que el VIX sin datos no votó', () => {
    const answer = answerJulssbot('¿qué dice el VIX sobre la volatilidad?', context);
    expect(answer).toContain('VIX diario: sin datos');
    expect(answer).toContain('nunca es una señal BUY/SELL');
  });
  it('explica una penalización VIX solo como corroboración', () => {
    const withVix = {
      ...context,
      decision: {
        ...context.decision,
        volatilityContext: {
          value: 32.15, regime: 'EXTREMO', trend: 'SUBIENDO', freshness: 'VIGENTE',
          observedAt: '2026-08-07T20:00:00Z', influence: 'PENALIZA_CORROBORADO',
          confidencePenalty: 5, ruleVersion: 'VIX_CONTEXT_V1',
        },
      },
    } as JulssbotContext;
    const answer = answerJulssbot('explícame el VIX', withVix);
    expect(answer).toContain('VIX diario 32.15');
    expect(answer).toContain('restó 5 puntos');
    expect(answer).toContain('no decidió la dirección');
  });
  it('incluye el contexto VIX en la explicación general', () => {
    expect(answerJulssbot('analiza completamente', context)).toContain('VIX diario: sin datos');
  });
  it('explica mercado, identidad canónica y diferencia fuentes verificadas de pendientes', () => {
    const answer = answerJulssbot('¿qué mercado y fuentes estás usando?', context);
    expect(answer).toContain('Divisas (FOREX)');
    expect(answer).toContain('FOREX:EUR/USD');
    expect(answer).toContain('Precio operativo verificado');
    expect(answer).toContain('TradingView');
    expect(answer).toContain('Fuentes verificadas en esta consulta: MT5');
  });
  it('no presenta una acción sin fundamentales ni documentos regulatorios como cobertura completa', () => {
    const stockContext = {
      ...context,
      symbol: 'NASDAQ:AAPL',
      market: {
        market: 'STOCK', marketLabel: 'Acción', canonicalId: 'STOCK:NASDAQ:AAPL',
        contractId: 'STOCK:NASDAQ:AAPL', instrumentKind: 'CASH', classificationConfidence: 'EXACT',
        coverage: 'PARTIAL', requiredRoleCount: 6, plannedRoleCount: 4, verifiedRoleCount: 1,
        readyForTechnicalAnalysis: true, readyForOperationalAnalysis: false,
        operationalPriceVerified: true, activeSources: ['MetaTrader 5'],
        pendingSources: ['AlphaSense'], gaps: ['Fundamentales corporativos', 'Documentos regulatorios'], warnings: [],
      },
    } as JulssbotContext;
    const answer = answerJulssbot('analiza completamente', stockContext);
    expect(answer).toContain('Acción (STOCK)');
    expect(answer).toContain('Fundamentales corporativos');
    expect(answer).toContain('no debe presentarse como análisis fundamental completo');
  });
  it('no presenta niveles como plan válido cuando la simulación no es elegible',()=>{
    const blocked={
      ...context,
      decision:{...context.decision,decision:'BUY_CONDICIONADO',confidence:68},
      plan:{...context.plan,active:true,direction:'BUY',trigger:1.1,maxEntry:1.11,stop:1.08,tp1:1.13,tp2:1.15},
      posture:{
        analyticalLabel:'SESGO BUY',analyticalDecision:'BUY_CONDICIONADO',analyticalConfidence:68,
        maturityStatus:'RESEARCH',maturitySample:0,recommendationStatus:'BLOCKED',recommendationAuthorized:false,
        executionStatus:'DISABLED',executionAuthorized:false,simulationEligible:false,
        reasons:['Datos inválidos.'],summary:'SESGO BUY 68%; modelo en investigación; no ejecutar automáticamente.',
      },
    } as JulssbotContext;
    expect(answerJulssbot('dame una entrada',blocked)).toContain('no existe un plan simulado válido');
  });
});
