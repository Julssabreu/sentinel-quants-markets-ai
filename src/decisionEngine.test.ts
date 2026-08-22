import { describe, expect, it } from 'vitest';
import { buildGuardedDecision, eventRelevantToSymbol } from './decisionEngine';
import type { IntermarketAnalysis } from './intermarketEngine';
import type { MultiTimeframeAnalysis } from './multiTimeframeAnalysis';
import type { VixContextAnalysis } from './vixContext';

const technical: MultiTimeframeAnalysis = {
  score:60, confidence:75, alignment:80, bias:'ALCISTA', available:21,
  bullish:['H4'], bearish:[], neutral:[], contradictions:[], results:[],
};
const event = (currency:string): MacroEvent => ({
  id:'1', title:'IPC', currency, impact:'High', scheduledAt:'2026-08-02T12:20:00Z',
  forecast:null, previous:null, source:'FF', sourceUrl:'', quality:'secondary',
});
const riskOff: IntermarketAnalysis = {
  score:-60, bias:'BAJISTA', confidence:75, fresh:true,
  composites:[], drivers:['Índices estadounidenses bajistas.'], contradictions:[],
};
const stressedVix: VixContextAnalysis = {
  kind:'MARKET_CONTEXT', source:'TRADINGVIEW_VIX_DAILY', ruleVersion:'VIX_CONTEXT_V1',
  availability:'DISPONIBLE', available:true, fresh:true, usableAsContext:true, vote:'NO_VOTE',
  currentLevel:28, currentTradingDate:'2026-08-01', currentObservedAt:'2026-08-01T20:00:00.000Z',
  regime:'ALTO', trend:'SUBIENDO',
  change1d:{fromTradingDate:'2026-07-31',toTradingDate:'2026-08-01',sessions:1,points:2,percent:7.69},
  change5Sessions:{fromTradingDate:'2026-07-25',toTradingDate:'2026-08-01',sessions:5,points:5,percent:21.74},
  score:72, businessDayLag:0, validSessions:6, rejectedPoints:0,
  reasons:['VIX utilizable como contexto.'],
};

describe('guarded decision', () => {
  it('reconoce impacto USD sobre oro y BTC', () => {
    expect(eventRelevantToSymbol(event('USD'),'XAU/USD')).toBe(true);
    expect(eventRelevantToSymbol(event('USD'),'BTC/USD')).toBe(true);
  });

  it('mantiene la prioridad del bloqueo macro', () => {
    const result = buildGuardedDecision(
      'BTC/USD', technical, [event('USD')], new Date('2026-08-02T12:00:00Z'),
      [], riskOff, undefined, undefined, stressedVix,
    );
    expect(result.decision).toBe('NO_OPERAR_EVENTO');
    expect(result.volatilityContext.confidencePenalty).toBe(0);
  });

  it('permite decisión sin evento relevante', () => {
    expect(buildGuardedDecision('EUR/USD',technical,[event('JPY')],new Date('2026-08-02T12:00:00Z')).decision)
      .toBe('BUY_CONDICIONADO');
  });

  it('usa VIX alto solo como referencia cuando no existe corroboración independiente', () => {
    const result = buildGuardedDecision(
      'US500', technical, [], new Date('2026-08-02T12:00:00Z'),
      [], undefined, undefined, undefined, stressedVix,
    );
    expect(result.confidence).toBe(75);
    expect(result.volatilityContext.influence).toBe('REFERENCIA');
    expect(result.volatilityContext.confidencePenalty).toBe(0);
  });

  it('penaliza con máximo 10 puntos una compra de índice estadounidense solo si intermercado confirma risk-off', () => {
    const withoutVix = buildGuardedDecision('US500',technical,[],new Date(),[],riskOff);
    const withVix = buildGuardedDecision('US500',technical,[],new Date(),[],riskOff,undefined,undefined,stressedVix);
    expect(withoutVix.confidence - withVix.confidence).toBe(10);
    expect(withVix.volatilityContext.influence).toBe('PENALIZA_CORROBORADO');
    expect(withVix.volatilityContext.confidencePenalty).toBe(10);
    expect(withVix.technicalConfidence).toBe(75);
  });

  it('limita la penalización corroborada de cripto a 5 puntos', () => {
    const result = buildGuardedDecision('BTC/USD',technical,[],new Date(),[],riskOff,undefined,undefined,stressedVix);
    expect(result.volatilityContext.confidencePenalty).toBe(5);
  });

  it('no altera FX ni convierte una lectura bajista en otra dirección', () => {
    const fx = buildGuardedDecision('EUR/USD',technical,[],new Date(),[],riskOff,undefined,undefined,stressedVix);
    const bearish: MultiTimeframeAnalysis = {...technical,bias:'BAJISTA',bullish:[],bearish:['H4']};
    const short = buildGuardedDecision('US500',bearish,[],new Date(),[],riskOff,undefined,undefined,stressedVix);
    expect(fx.volatilityContext.confidencePenalty).toBe(0);
    expect(short.volatilityContext.confidencePenalty).toBe(0);
    expect(short.decision).toBe('SELL_CONDICIONADO');
  });

  it('deja sin voto un VIX desactualizado', () => {
    const stale = {...stressedVix,fresh:false,usableAsContext:false} satisfies VixContextAnalysis;
    const result = buildGuardedDecision('US500',technical,[],new Date(),[],riskOff,undefined,undefined,stale);
    expect(result.volatilityContext.influence).toBe('SIN_VOTO');
    expect(result.volatilityContext.confidencePenalty).toBe(0);
  });
});
