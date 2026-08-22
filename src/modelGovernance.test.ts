import { describe, expect, it } from 'vitest';
import {
  evaluateModelGovernance,
  MODEL_MANIFEST,
  modelFingerprint,
} from './modelGovernance';
// @ts-expect-error CommonJS shared production module
import modelContract from '../shared/modelContract.cjs';

const LEGACY_MANIFEST = {
  modelId: 'SENTINEL_CONSENSUS',
  version: '0.3.0-research',
  features: ['MTF_21', 'EVENT_RISK', 'NEWS_RISK', 'ATOMIC_SECONDARY', 'PORTFOLIO_GATE'],
  trainingPolicy: 'walk-forward-purged',
  execution: 'advisory-only',
};

const record = (
  index: number,
  win: boolean,
  fingerprint: string | undefined = modelFingerprint(),
): AnalysisHistoryRecord => {
  const base={
    id: String(index),
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    schemaVersion: 3,
    legacySemantics: false,
    symbol: 'EUR/USD',
    brokerSymbol: 'EURUSD',
    timeframe: 'H1',
    decision: 'BUY_CONDICIONADO',
    analyticalDecision:'BUY_CONDICIONADO',
    confidence: 70,
    technicalConfidence: 70,
    alignment: 70,
    eventAction: 'NORMAL',
    blockingEvent: null,
    modelId:MODEL_MANIFEST.modelId,
    modelVersion:MODEL_MANIFEST.version,
    modelFingerprint: fingerprint,
    simulationEligible: true,
    simulationAnchorTime:new Date(Date.UTC(2026,0,index+1,index)).toISOString(),
    planMode: 'SIMULATION' as const,
    strategy:'BREAKOUT_STRUCTURE_ATR',
    plan: { direction: 'BUY', trigger: 1, maxEntry:1.01, stop: 0.9, tp1: 1.1, tp2: 1.2, expiresAfterBars:3, mode:'SIMULATED' as const },
    sources: ['MT5'],
    outcome: { status: win ? 'TP2' : 'STOP', checkedAt: '' },
  };
  return {...base,simulationFingerprint:modelContract.simulationFingerprint(base)} as AnalysisHistoryRecord;
};

describe('model governance', () => {
  it('declara VIX diario y el enrutador multimercado como features versionadas', () => {
    expect(MODEL_MANIFEST.version).toBe('0.3.4-research');
    expect(MODEL_MANIFEST.features).toContain('VIX_DAILY_CONTEXT_V1');
    expect(MODEL_MANIFEST.features).toContain('MULTI_MARKET_ROUTER_V1');
    expect(MODEL_MANIFEST.features).toContain('ANALYTICAL_OPERATIONAL_SEPARATION_V1');
    expect(MODEL_MANIFEST.features).toContain('SIMULATION_OUTCOME_V2');
    expect(modelFingerprint()).not.toBe(modelFingerprint(LEGACY_MANIFEST));
  });

  it('mantiene un fingerprint reproducible', () => {
    expect(modelFingerprint()).toBe(modelFingerprint());
    expect(modelFingerprint()).toBe(modelContract.MODEL_FINGERPRINT);
  });

  it('mantiene investigación sin muestra', () => {
    expect(evaluateModelGovernance([]).status).toBe('RESEARCH');
  });

  it('suspende expectativa negativa de la versión vigente', () => {
    const governance = evaluateModelGovernance(
      Array.from({ length: 30 }, (_, index) => record(index, index % 4 === 0)),
    );
    expect(governance.status).toBe('SUSPENDED');
    expect(governance.sample).toBe(30);
  });

  it('excluye resultados resueltos con fingerprint anterior', () => {
    const legacyFingerprint = modelFingerprint(LEGACY_MANIFEST);
    const governance = evaluateModelGovernance(
      Array.from({ length: 30 }, (_, index) => record(index, index % 4 === 0, legacyFingerprint)),
    );
    expect(governance.status).toBe('RESEARCH');
    expect(governance.sample).toBe(0);
    expect(governance.reasons).toContain(
      'Se excluyeron 30 resultados de versiones anteriores o sin fingerprint.',
    );
  });

  it('excluye registros sin fingerprint y conserva solo la muestra compatible', () => {
    const incompatible = Array.from({ length: 30 }, (_, index) =>
      record(index, true, undefined),
    ).map(({ modelFingerprint: _modelFingerprint, ...item }) => item as AnalysisHistoryRecord);
    const compatible = Array.from({ length: 5 }, (_, index) => record(index + 40, true));
    const governance = evaluateModelGovernance([...incompatible, ...compatible]);

    expect(governance.status).toBe('RESEARCH');
    expect(governance.sample).toBe(5);
    expect(governance.reasons).toContain(
      'Se excluyeron 30 resultados de versiones anteriores o sin fingerprint.',
    );
  });

  it('no cuenta dos veces la misma simulación resuelta',()=>{
    const duplicated=record(50,true);
    const governance=evaluateModelGovernance([
      duplicated,
      {...duplicated,id:'duplicate-copy'},
    ]);
    expect(governance.sample).toBe(1);
  });

  it('mantiene RESEARCH con 29 resultados simulados compatibles',()=>{
    const governance=evaluateModelGovernance(
      Array.from({length:29},(_,index)=>record(index,index%4!==0)),
    );
    expect(governance.status).toBe('RESEARCH');
    expect(governance.sample).toBe(29);
    expect(governance.canVote).toBe(false);
  });

  it('excluye un resultado con fingerprint si no es una simulación v3 completa',()=>{
    const incomplete={
      ...record(60,true),
      schemaVersion:2,
      planMode:null,
      simulationEligible:undefined,
      simulationFingerprint:undefined,
    } as AnalysisHistoryRecord;
    expect(evaluateModelGovernance([incomplete]).sample).toBe(0);
  });

  it('usa la confianza analítica para calibrar resultados nuevos',()=>{
    const records=Array.from({length:30},(_,index)=>({
      ...record(index,true),
      confidence:0,
      analyticalConfidence:70,
    }));
    const governance=evaluateModelGovernance(records);
    expect(governance.brierScore).toBeCloseTo(.09,5);
    expect(governance.status).toBe('ACTIVE');
  });

  it('no aplica drift contra una línea base de un solo resultado',()=>{
    const records=[
      record(0,true),
      ...Array.from({length:30},(_,index)=>record(index+40,index<25)),
    ];
    const governance=evaluateModelGovernance(records);
    expect(governance.baselineAverageR).toBeNull();
    expect(governance.drift).toBeNull();
    expect(governance.status).toBe('ACTIVE');
  });
});
