import { describe, expect, it } from 'vitest';
import {
  simpleMovingAverage, trueRange, averageTrueRange, classicPivots,
  relativeStrengthIndex, periodRange, rangeBudget,
  buildLevelPlan, positionSize, assessConviction,
  // @ts-expect-error CommonJS shared production module
} from '../shared/technicalLevels.cjs';

const bar = (o: number, h: number, l: number, c: number) => ({ o, h, l, c });

describe('simpleMovingAverage', () => {
  it('promedia los últimos N cierres', () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toBeCloseTo(4, 10); // (3+4+5)/3
  });
  it('devuelve null si no hay historia suficiente, en vez de un promedio parcial', () => {
    expect(simpleMovingAverage([1, 2], 5)).toBeNull();
  });
});

describe('trueRange', () => {
  it('usa el mayor de los tres rangos posibles', () => {
    // H-L=5, |H-prevC|=12, |L-prevC|=7 → 12
    expect(trueRange(bar(100, 105, 100, 104), 93)).toBe(12);
  });
  it('sin cierre previo cae al rango de la vela', () => {
    expect(trueRange(bar(100, 105, 100, 104), null)).toBe(5);
  });
});

describe('averageTrueRange — suavizado de Wilder', () => {
  it('coincide con el cálculo manual de Wilder, no con una media simple', () => {
    // 15 velas con rango verdadero constante de 2 → ATR = 2 exacto.
    const bars = Array.from({ length: 16 }, (_, i) => bar(100 + i, 101 + i, 99 + i, 100 + i));
    const atr = averageTrueRange(bars, 14);
    expect(atr).toBeGreaterThan(0);
    // El TR aquí es max(2, |101+i - (100+i-1)|=2, |99+i-(100+i-1)|=0) = 2
    expect(atr).toBeCloseTo(2, 6);
  });

  it('el suavizado reacciona menos que una media simple a un salto reciente', () => {
    const flat = Array.from({ length: 30 }, (_, i) => bar(100, 101, 99, 100));
    const withSpike = [...flat.slice(0, 29), bar(100, 130, 70, 100)];
    const atrFlat = averageTrueRange(flat, 14);
    const atrSpike = averageTrueRange(withSpike, 14);
    expect(atrSpike).toBeGreaterThan(atrFlat);
    // Con Wilder el salto pesa 1/14, así que no dispara el ATR al rango del salto.
    expect(atrSpike).toBeLessThan(20);
  });

  it('devuelve null sin velas suficientes', () => {
    expect(averageTrueRange([bar(1, 2, 0, 1)], 14)).toBeNull();
  });
});

describe('classicPivots', () => {
  it('calcula P, R1-R3 y S1-S3 con las fórmulas estándar', () => {
    // H=110, L=90, C=100 → P=100, rango=20
    const p = classicPivots(110, 90, 100);
    expect(p.p).toBeCloseTo(100, 10);
    expect(p.r1).toBeCloseTo(110, 10);  // 2*100-90
    expect(p.s1).toBeCloseTo(90, 10);   // 2*100-110
    expect(p.r2).toBeCloseTo(120, 10);  // 100+20
    expect(p.s2).toBeCloseTo(80, 10);   // 100-20
    expect(p.r3).toBeCloseTo(130, 10);  // 110+2*(100-90)
    expect(p.s3).toBeCloseTo(70, 10);   // 90-2*(110-100)
  });

  it('mantiene el orden S3 < S2 < S1 < P < R1 < R2 < R3', () => {
    const p = classicPivots(110, 90, 100);
    const ordered = [p.s3, p.s2, p.s1, p.p, p.r1, p.r2, p.r3];
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it('rechaza entradas incoherentes', () => {
    expect(classicPivots(90, 110, 100)).toBeNull(); // máximo menor que mínimo
    expect(classicPivots(NaN, 90, 100)).toBeNull();
  });
});

describe('relativeStrengthIndex', () => {
  it('da 100 cuando solo hay subidas', () => {
    expect(relativeStrengthIndex(Array.from({ length: 20 }, (_, i) => 100 + i), 14)).toBeCloseTo(100, 6);
  });
  it('da un valor bajo cuando solo hay caídas', () => {
    expect(relativeStrengthIndex(Array.from({ length: 20 }, (_, i) => 100 - i), 14)).toBeCloseTo(0, 6);
  });
  it('devuelve null sin historia suficiente', () => {
    expect(relativeStrengthIndex([1, 2, 3], 14)).toBeNull();
  });
});

describe('periodRange', () => {
  it('toma el máximo y mínimo reales del periodo', () => {
    const range = periodRange([bar(10, 20, 5, 15), bar(15, 30, 12, 25)]);
    expect(range).toMatchObject({ high: 30, low: 5, bars: 2 });
  });
  it('ignora velas corruptas', () => {
    expect(periodRange([null, { h: 1 }, bar(10, 20, 5, 15)] as never[])).toMatchObject({ high: 20, low: 5, bars: 1 });
  });
});

describe('rangeBudget', () => {
  it('declara cuánto del ATR diario ya se consumió', () => {
    const budget = rangeBudget(112, 100, 10); // recorrió 12 sobre un ATR de 10
    expect(budget.consumedPercent).toBeCloseTo(120, 10);
    expect(budget.remaining).toBe(0);
  });
  it('reporta el recorrido restante cuando aún queda', () => {
    const budget = rangeBudget(105, 100, 10);
    expect(budget.consumedPercent).toBeCloseTo(50, 10);
    expect(budget.remaining).toBeCloseTo(5, 10);
  });
});

describe('buildLevelPlan', () => {
  it('entra en la primera resistencia por encima del precio, nunca a mercado', () => {
    const plan = buildLevelPlan({ price: 100, resistances: [95, 105, 110], atr: 10 });
    expect(plan.entry).toBe(105); // 95 queda descartada por estar debajo
  });

  it('aplica el suelo porcentual cuando el ATR daría un stop demasiado estrecho', () => {
    // 0.4 × ATR = 0.4 ; 0.8 % de 105 = 0.84 → gana el suelo porcentual
    const plan = buildLevelPlan({ price: 100, resistances: [105], atr: 1 });
    expect(plan.riskPerShare).toBeCloseTo(0.84, 10);
    expect(plan.riskPercent).toBeCloseTo(0.8, 10);
  });

  it('usa el ATR cuando supera el suelo porcentual', () => {
    const plan = buildLevelPlan({ price: 100, resistances: [105], atr: 10 });
    expect(plan.riskPerShare).toBeCloseTo(4, 10); // 0.4 × 10
    expect(plan.stop).toBeCloseTo(101, 10);
  });

  it('coloca los objetivos en 1,5R y 2,5R', () => {
    const plan = buildLevelPlan({ price: 100, resistances: [105], atr: 10 });
    expect(plan.target1).toBeCloseTo(105 + 6, 10);   // 1.5 × 4
    expect(plan.target2).toBeCloseTo(105 + 10, 10);  // 2.5 × 4
  });

  it('no da plan si no hay resistencia por encima, en vez de inventar un nivel', () => {
    expect(buildLevelPlan({ price: 100, resistances: [90, 95], atr: 10 })).toBeNull();
    expect(buildLevelPlan({ price: 100, resistances: [], atr: 10 })).toBeNull();
  });
});

describe('positionSize', () => {
  it('calcula acciones enteras para el riesgo declarado', () => {
    expect(positionSize(100, 4.36)).toBe(22); // 100/4.36 = 22.9 → 22
  });
  it('devuelve null si el riesgo por acción supera el monto', () => {
    expect(positionSize(10, 50)).toBeNull();
  });
});

describe('assessConviction', () => {
  it('es ALTA solo cuando ninguna señal penaliza', () => {
    const result = assessConviction({ rangeBudgetPercent: 40, rsi: 55, volumeRatio: 2, belowLongTermTrend: false });
    expect(result.level).toBe('ALTA');
    expect(result.warnings).toEqual([]);
  });

  it('penaliza el recorrido ya consumido citando el dato', () => {
    const result = assessConviction({ rangeBudgetPercent: 135, rsi: 55, volumeRatio: 2 });
    expect(result.warnings.join(' ')).toContain('135');
  });

  it('baja a BAJA cuando se acumulan señales de agotamiento', () => {
    const result = assessConviction({ rangeBudgetPercent: 135, rsi: 78, volumeRatio: 0.5, belowLongTermTrend: true });
    expect(result.level).toBe('BAJA');
    expect(result.warnings).toHaveLength(4);
  });

  it('detecta sobreventa además de sobrecompra', () => {
    expect(assessConviction({ rsi: 22 }).warnings.join(' ')).toContain('sobreventa');
  });
});
