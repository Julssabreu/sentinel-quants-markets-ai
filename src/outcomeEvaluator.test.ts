import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import evaluator from '../shared/outcomeEvaluator.cjs';
// @ts-expect-error CommonJS shared production module
import modelContract from '../shared/modelContract.cjs';

const buyPlan = {
  direction: 'BUY',
  trigger: 100,
  maxEntry: 100.3,
  stop: 98,
  tp1: 103,
  tp2: 105,
  expiresAfterBars: 3,
};
const sellPlan = {
  direction: 'SELL',
  trigger: 100,
  maxEntry: 99.7,
  stop: 102,
  tp1: 97,
  tp2: 95,
  expiresAfterBars: 3,
};
const anchor = '2026-08-02T12:00:00.000Z';
const at = (hours: number) => new Date(Date.parse(anchor) + hours * 3_600_000).toISOString();

describe('outcome evaluator', () => {
  it('excluye estrictamente la vela ancla aunque toque todos los niveles', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: anchor, open: 100, high: 106, low: 97, close: 104 },
      { time: at(1), open: 99, high: 99.5, low: 98.5, close: 99 },
    ], anchor);

    expect(result.status).toBe('NOT_TRIGGERED');
    expect(result.barsObserved).toBe(1);
    expect(result.lastEvaluatedAt).toBe(at(1));
  });

  it('detecta TP2 posterior a la activación', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 99.5, high: 101, low: 99, close: 100.5 },
      { time: at(2), open: 101, high: 106, low: 100, close: 105 },
    ], anchor);
    expect(result.status).toBe('TP2');
  });

  it('marca ambigüedad si la activación intravela y el stop aparecen juntos', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 99, high: 106, low: 97, close: 100 },
    ], anchor);
    expect(result.status).toBe('AMBIGUOUS');
  });

  it('invalida un gap previo que abre más allá de la entrada máxima', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 101, high: 102, low: 100.7, close: 101.5 },
    ], anchor);
    expect(result.status).toBe('INVALIDATED');
    expect(result.resolution).toBe('GAP_BEYOND_MAX_ENTRY');
  });

  it('invalida por toque del stop previo aunque la vela recupere al cierre', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 99, high: 99.5, low: 97.5, close: 99.2 },
    ], anchor);
    expect(result.status).toBe('INVALIDATED');
  });
});

describe('evaluación incremental persistente', () => {
  it('reanuda desde el estado previo sin volver a contar la última vela', () => {
    const first = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 100, high: 101, low: 99, close: 100.5 },
    ], anchor);
    expect(first.status).toBe('OPEN');
    expect(first.barsObserved).toBe(1);

    const second = evaluator.evaluatePlan(buyPlan, [
      // La consulta inclusiva de MT5 puede repetir el cursor.
      { time: at(1), open: 100, high: 101, low: 99, close: 100.5 },
      { time: at(2), open: 101, high: 106, low: 100, close: 105 },
    ], anchor, first);

    expect(second.status).toBe('TP2');
    expect(second.activatedAt).toBe(first.activatedAt);
    expect(second.barsObserved).toBe(2);
    expect(second.lastEvaluatedAt).toBe(at(2));
  });

  it('acumula la caducidad entre varias páginas', () => {
    const first = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 99, high: 99.5, low: 98.5, close: 99 },
      { time: at(2), open: 99, high: 99.5, low: 98.5, close: 99 },
    ], anchor);
    expect(first.status).toBe('NOT_TRIGGERED');
    expect(first.barsObserved).toBe(2);

    const second = evaluator.evaluatePlan(buyPlan, [
      { time: at(3), open: 99, high: 99.5, low: 98.5, close: 99 },
    ], anchor, first);
    expect(second.status).toBe('EXPIRED');
    expect(second.barsObserved).toBe(3);
  });

  it('conserva TP1 y métricas al continuar una operación abierta', () => {
    const first = evaluator.evaluatePlan(buyPlan, [
      { time: at(1), open: 100, high: 104, low: 99, close: 103 },
    ], anchor);
    expect(first.status).toBe('OPEN_TP1_REACHED');

    const second = evaluator.evaluatePlan(buyPlan, [
      { time: at(2), open: 102, high: 102.5, low: 97.5, close: 98 },
    ], anchor, first);
    expect(second.status).toBe('STOP');
    expect(second.tp1Reached).toBe(true);
    expect(second.mfe).toBeGreaterThanOrEqual(first.mfe);
  });
});

describe('gaps conocidos después de activar', () => {
  const activeBuy = {
    status: 'OPEN',
    activatedAt: at(1),
    activationPrice: 100,
    lastEvaluatedAt: at(1),
    barsObserved: 1,
    mfe: 1,
    mae: 1,
    tp1Reached: false,
  };
  const activeSell = { ...activeBuy };

  it('resuelve STOP de BUY en la apertura aunque luego la vela alcance TP2', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: at(2), open: 97, high: 106, low: 96, close: 104 },
    ], anchor, activeBuy);
    expect(result.status).toBe('STOP');
    expect(result.resolution).toBe('GAP_AT_OPEN');
    expect(result.fillPrice).toBe(97);
  });

  it('resuelve TP2 de BUY en la apertura aunque luego la vela alcance el stop', () => {
    const result = evaluator.evaluatePlan(buyPlan, [
      { time: at(2), open: 106, high: 107, low: 97, close: 99 },
    ], anchor, activeBuy);
    expect(result.status).toBe('TP2');
    expect(result.resolution).toBe('GAP_AT_OPEN');
  });

  it('resuelve STOP de SELL en la apertura', () => {
    const result = evaluator.evaluatePlan(sellPlan, [
      { time: at(2), open: 103, high: 104, low: 94, close: 96 },
    ], anchor, activeSell);
    expect(result.status).toBe('STOP');
    expect(result.resolution).toBe('GAP_AT_OPEN');
  });

  it('resuelve TP2 de SELL en la apertura', () => {
    const result = evaluator.evaluatePlan(sellPlan, [
      { time: at(2), open: 94, high: 103, low: 93, close: 101 },
    ], anchor, activeSell);
    expect(result.status).toBe('TP2');
    expect(result.resolution).toBe('GAP_AT_OPEN');
  });
});

describe('lote histórico justo', () => {
  const pendingRecord = (index: number) => {
    const record = {
      id: `record-${index}`,
      schemaVersion: 3,
      legacySemantics: false,
      simulationEligible: true,
      planMode: 'SIMULATION',
      simulationAnchorTime: at(1),
      createdAt: new Date(Date.parse(anchor) + index * 1000).toISOString(),
      modelId: modelContract.MODEL_MANIFEST.modelId,
      modelVersion: modelContract.MODEL_MANIFEST.version,
      modelFingerprint: modelContract.MODEL_FINGERPRINT,
      strategy: 'BREAKOUT_STRUCTURE_ATR',
      analyticalDecision: 'BUY_CONDICIONADO',
      decision: 'BUY_CONDICIONADO',
      plan: { ...buyPlan, mode: 'SIMULATED' },
      outcome: null,
      lastEvaluationAttemptAt: null as string | null,
    };
    return { ...record, simulationFingerprint: modelContract.simulationFingerprint(record) };
  };

  it('rota hacia pendientes antiguos en vez de reevaluar siempre los primeros', () => {
    const records = Array.from({ length: 20 }, (_, index) => pendingRecord(index));
    const first = evaluator.selectFairEvaluationBatch(records, 5).batch;
    expect(first.map((record: { id: string }) => record.id)).toEqual([
      'record-0', 'record-1', 'record-2', 'record-3', 'record-4',
    ]);

    first.forEach((record: { lastEvaluationAttemptAt: string | null }) => {
      record.lastEvaluationAttemptAt = at(4);
    });
    const second = evaluator.selectFairEvaluationBatch(records, 5).batch;
    expect(second.map((record: { id: string }) => record.id)).toEqual([
      'record-5', 'record-6', 'record-7', 'record-8', 'record-9',
    ]);
  });

  it('excluye resultados terminales del lote', () => {
    const terminal = { ...pendingRecord(0), outcome: { status: 'STOP' } };
    const open = { ...pendingRecord(1), outcome: { status: 'OPEN' } };
    expect(evaluator.selectFairEvaluationBatch([terminal, open], 5).batch).toEqual([open]);
  });
});
