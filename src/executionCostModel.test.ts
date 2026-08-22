import { describe, expect, it } from 'vitest';
import { evaluateExitOnBar, prepareExecutedTrade, type ExecutionCostProfile } from './executionCostModel';

const costs: ExecutionCostProfile = { id:'TEST', spreadPrice:1, slippagePrice:.25, commissionRoundTripPrice:.5, latencyMs:0, conservativeSameBar:true };
describe('conservative execution model', () => {
  it('mide bruto y neto sobre el mismo riesgo, para que su diferencia sea el costo', () => {
    const plan = prepareExecutedTrade('LONG', 100, 98, 104, costs);
    const exit = evaluateExitOnBar(plan, { time:'2026-01-01T00:00:00Z', open:100, high:104, low:99, close:103 }, costs)!;
    expect(exit.reason).toBe('TARGET');

    // El 2R de manual asumía entrar a 100 y arriesgar 2. En realidad se entra a 100.75
    // (medio spread + deslizamiento) y se arriesgan 2.75, así que el bruto real es
    // 3.25/2.75 = 1.18R. Antes bruto y neto usaban denominadores distintos y su
    // diferencia mezclaba el costo con un cambio de base.
    expect(plan.entryFill).toBe(100.75);
    expect(plan.riskPrice).toBe(2.75);
    expect(exit.grossResultR).toBeCloseTo(3.25 / 2.75, 10);
    expect(exit.netResultR).toBeCloseTo(2 / 2.75, 10);

    // Con un denominador común la diferencia es exactamente el costo de salida más la
    // comisión: (spread/2 + deslizamiento + comisión) / riesgo.
    expect(exit.grossResultR - exit.netResultR).toBeCloseTo((0.5 + 0.25 + 0.5) / 2.75, 10);
  });
  it('assumes stop first when stop and target occur in the same candle', () => {
    const plan = prepareExecutedTrade('SHORT', 100, 102, 96, costs);
    expect(evaluateExitOnBar(plan, { time:'2026-01-01T00:00:00Z', open:100, high:103, low:95, close:99 }, costs)?.reason).toBe('STOP');
  });
  it('models adverse stop gaps', () => {
    const plan = prepareExecutedTrade('LONG', 100, 98, 104, costs);
    expect(evaluateExitOnBar(plan, { time:'2026-01-01T00:00:00Z', open:95, high:97, low:94, close:96 }, costs)!.grossResultR).toBeLessThan(-1);
  });
  it('cuenta la vela ambigua en vez de resolverla en silencio', () => {
    const plan = prepareExecutedTrade('SHORT', 100, 102, 96, costs);
    // Toca stop y objetivo en la misma vela: sin datos intrabarra no se sabe el orden.
    const both = evaluateExitOnBar(plan, { time:'2026-01-01T00:00:00Z', open:100, high:103, low:95, close:99 }, costs)!;
    expect(both.reason).toBe('STOP');
    expect(both.ambiguous).toBe(true);

    // Una salida limpia no debe marcarse como ambigua.
    const clean = evaluateExitOnBar(plan, { time:'2026-01-01T00:00:00Z', open:100, high:101, low:95, close:96 }, costs)!;
    expect(clean.reason).toBe('TARGET');
    expect(clean.ambiguous).toBe(false);
  });

  it('rechaza el plan cuando el hueco de apertura destruye el ratio exigido', () => {
    // Entrada 100, stop 98, objetivo 106: en el precio de llenado da 1.91R y pasa.
    expect(prepareExecutedTrade('LONG', 100, 98, 106, costs, 1.5).realizedRR).toBeCloseTo(5.25 / 2.75, 10);
    // Si la vela siguiente abre en 102, el mismo plan solo ofrece 0.68R. No debe
    // ejecutarse por haber cumplido el umbral en el cierre M5 que originó la señal.
    expect(() => prepareExecutedTrade('LONG', 102, 98, 106, costs, 1.5))
      .toThrow(/el ratio es 0\.68R y el mínimo exigido es 1\.5R/);
  });

  it('rejects plans whose stop sits on the wrong side of the entry', () => {
    // Caso real de la ablación WITHOUT_M5_CONFIRMATION: sin confirmar la ruptura, un
    // BUY puede salir con el cierre M5 por debajo del mínimo de las velas previas.
    expect(() => prepareExecutedTrade('LONG', 100, 102, 108, costs)).toThrow(/stop debe quedar por debajo/);
    expect(() => prepareExecutedTrade('SHORT', 100, 98, 92, costs)).toThrow(/stop debe quedar por encima/);
  });
  it('rejects plans whose target sits on the wrong side of the entry', () => {
    expect(() => prepareExecutedTrade('LONG', 100, 98, 99, costs)).toThrow(/objetivo debe quedar por encima/);
    expect(() => prepareExecutedTrade('SHORT', 100, 102, 101, costs)).toThrow(/objetivo debe quedar por debajo/);
  });
});
