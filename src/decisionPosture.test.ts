import { describe, expect, it } from 'vitest';
import { NO_VIX_DECISION_CONTEXT, type DecisionResult } from './decisionEngine';
import { evaluateDecisionPosture } from './decisionPosture';
import type { ModelGovernance } from './modelGovernance';
import type { TradePlan } from './tradePlan';

const decision: DecisionResult = {
  decision:'BUY_CONDICIONADO', confidence:68, technicalConfidence:74,
  eventAction:'NORMAL', reasons:['Sesgo técnico alcista.'],
  volatilityContext:NO_VIX_DECISION_CONTEXT,
};
const plan: TradePlan = {
  active:true, direction:'BUY', trigger:101, maxEntry:102, stop:98, tp1:104, tp2:108,
  riskReward1:1, riskReward2:2.33, atr:2, expiresAfterBars:3, cancellation:[],
};
const governance = (status:ModelGovernance['status'], canVote:boolean):ModelGovernance => ({
  modelId:'SENTINEL_CONSENSUS', version:'test', fingerprint:'test', status, sample:0,
  brierScore:null, recentAverageR:0, baselineAverageR:null, drift:null,
  reasons:['Muestra insuficiente: 0/30 resultados recientes.'], canVote,
});

describe('separación analítica y operativa',()=>{
  it('conserva BUY y confianza durante investigación, pero bloquea la recomendación',()=>{
    const result=evaluateDecisionPosture({
      decision, plan, governance:governance('RESEARCH',false),
      dataQualityValid:true, tickFresh:true, technicalReady:true, operationalMarketReady:true,
    });
    expect(result.analyticalDecision).toBe('BUY_CONDICIONADO');
    expect(result.analyticalConfidence).toBe(68);
    expect(result.recommendationStatus).toBe('RESEARCH_ONLY');
    expect(result.simulationEligible).toBe(true);
    expect(result.executionAuthorized).toBe(false);
    expect(result.summary).toContain('SESGO BUY 68%');
  });

  it('permite revisión manual al madurar sin habilitar ejecución',()=>{
    const result=evaluateDecisionPosture({
      decision, plan, governance:governance('ACTIVE',true),
      dataQualityValid:true, tickFresh:true, technicalReady:true, operationalMarketReady:true,
    });
    expect(result.recommendationStatus).toBe('MANUAL_REVIEW');
    expect(result.recommendationAuthorized).toBe(true);
    expect(result.executionStatus).toBe('DISABLED');
    expect(result.executionAuthorized).toBe(false);
  });

  it('no registra una simulación elegible con datos inválidos',()=>{
    const result=evaluateDecisionPosture({
      decision, plan, governance:governance('RESEARCH',false),
      dataQualityValid:false, tickFresh:true, technicalReady:true, operationalMarketReady:true,
    });
    expect(result.recommendationStatus).toBe('BLOCKED');
    expect(result.simulationEligible).toBe(false);
    expect(result.reasons).toContain('La calidad del dataset no permite validar el escenario.');
  });

  it('conserva la simulación técnica aunque una cobertura integral siga pendiente',()=>{
    const result=evaluateDecisionPosture({
      decision, plan, governance:governance('RESEARCH',false),
      dataQualityValid:true, tickFresh:true, technicalReady:true, operationalMarketReady:false,
    });
    expect(result.simulationEligible).toBe(true);
    expect(result.recommendationStatus).toBe('BLOCKED');
    expect(result.executionAuthorized).toBe(false);
  });

  it('trata un modelo suspendido como bloqueo y no como investigación',()=>{
    const result=evaluateDecisionPosture({
      decision, plan, governance:governance('SUSPENDED',false),
      dataQualityValid:true, tickFresh:true, technicalReady:true, operationalMarketReady:true,
    });
    expect(result.simulationEligible).toBe(true);
    expect(result.recommendationStatus).toBe('BLOCKED');
  });
});
