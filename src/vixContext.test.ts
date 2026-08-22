import { describe, expect, it } from 'vitest';
import {
  analyzeVixContext,
  classifyVixRegime,
  isConservativeRiskOnAsset,
  type VixDailyPoint,
} from './vixContext';

function point(tradingDate: string, value: number, receivedAt?: string): VixDailyPoint {
  return {
    tradingDate,
    value,
    open: value,
    high: value + 0.5,
    low: Math.max(0, value - 0.5),
    observedAt: `${tradingDate}T21:00:00.000Z`,
    receivedAt: receivedAt ?? `${tradingDate}T21:00:05.000Z`,
  };
}

const risingSeries = [
  point('2026-08-03', 18),
  point('2026-08-04', 18.5),
  point('2026-08-05', 19),
  point('2026-08-06', 20),
  point('2026-08-07', 21),
  point('2026-08-10', 22.5),
];

describe('VIX context', () => {
  it('clasifica los límites conservadores de régimen', () => {
    expect(classifyVixRegime(14.99)).toBe('CALMA');
    expect(classifyVixRegime(15)).toBe('NORMAL');
    expect(classifyVixRegime(20)).toBe('ELEVADO');
    expect(classifyVixRegime(25)).toBe('ALTO');
    expect(classifyVixRegime(30)).toBe('EXTREMO');
    expect(classifyVixRegime(Number.NaN)).toBeNull();
  });

  it('produce contexto utilizable, tendencia y cambios de 1 y 5 sesiones', () => {
    const result = analyzeVixContext(risingSeries, {
      now: new Date('2026-08-11T15:00:00.000Z'),
    });

    expect(result.availability).toBe('DISPONIBLE');
    expect(result.fresh).toBe(true);
    expect(result.usableAsContext).toBe(true);
    expect(result.currentLevel).toBe(22.5);
    expect(result.regime).toBe('ELEVADO');
    expect(result.trend).toBe('SUBIENDO');
    expect(result.change1d?.points).toBe(1.5);
    expect(result.change5Sessions?.points).toBe(4.5);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.kind).toBe('MARKET_CONTEXT');
    expect(result.vote).toBe('NO_VOTE');
    expect(Object.keys(result)).not.toContain('side');
  });

  it('tolera el fin de semana al evaluar frescura diaria', () => {
    const fridaySeries = risingSeries.map((entry, index) => ({
      ...entry,
      tradingDate: ['2026-07-31', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'][index],
      observedAt: `${['2026-07-31', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'][index]}T21:00:00.000Z`,
      receivedAt: `${['2026-07-31', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'][index]}T21:00:05.000Z`,
    }));

    const sunday = analyzeVixContext(fridaySeries, {
      now: new Date('2026-08-09T16:00:00.000Z'),
    });
    const monday = analyzeVixContext(fridaySeries, {
      now: new Date('2026-08-10T16:00:00.000Z'),
    });
    const tuesday = analyzeVixContext(fridaySeries, {
      now: new Date('2026-08-11T16:00:00.000Z'),
    });

    expect(sunday.businessDayLag).toBe(0);
    expect(sunday.fresh).toBe(true);
    expect(monday.businessDayLag).toBe(1);
    expect(monday.fresh).toBe(true);
    expect(tuesday.businessDayLag).toBe(2);
    expect(tuesday.fresh).toBe(false);
    expect(tuesday.score).toBeNull();
  });

  it('no deja votar ni calcula score con historial insuficiente', () => {
    const result = analyzeVixContext([point('2026-08-10', 19)], {
      now: new Date('2026-08-10T22:00:00.000Z'),
    });

    expect(result.availability).toBe('INSUFICIENTE');
    expect(result.available).toBe(true);
    expect(result.trend).toBe('INSUFICIENTE');
    expect(result.score).toBeNull();
    expect(result.usableAsContext).toBe(false);
    expect(result.vote).toBe('NO_VOTE');
  });

  it('detecta tendencia bajando y conserva un score dentro de 0-100', () => {
    const falling = [28, 27.5, 26, 25, 24, 22].map((value, index) =>
      point(`2026-08-${String(index + 3).padStart(2, '0')}`, value));
    const result = analyzeVixContext(falling, {
      now: new Date('2026-08-08T16:00:00.000Z'),
    });

    expect(result.trend).toBe('BAJANDO');
    expect(result.score).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('ignora puntos inválidos y conserva la revisión más reciente de una sesión', () => {
    const duplicate = point('2026-08-10', 23, '2026-08-10T22:00:00.000Z');
    const invalid = { ...point('2026-08-11', 20), high: 10 };
    const result = analyzeVixContext([...risingSeries, duplicate, invalid], {
      now: new Date('2026-08-11T15:00:00.000Z'),
    });

    expect(result.currentLevel).toBe(23);
    expect(result.validSessions).toBe(6);
    expect(result.rejectedPoints).toBe(2);
  });

  it('acepta el contrato del Worker con observationDate y OHLC ausente', () => {
    const workerSeries: VixDailyPoint[] = risingSeries.map(({ tradingDate, value, observedAt, receivedAt }) => ({
      observationDate: tradingDate,
      value,
      observedAt,
      receivedAt,
    }));
    const result = analyzeVixContext(workerSeries, {
      now: new Date('2026-08-11T15:00:00.000Z'),
    });

    expect(result.availability).toBe('DISPONIBLE');
    expect(result.currentTradingDate).toBe('2026-08-10');
    expect(result.currentLevel).toBe(22.5);
    expect(result.rejectedPoints).toBe(0);
  });

  it('no inventa contexto cuando todos los datos son inválidos', () => {
    const result = analyzeVixContext([
      { ...point('fecha-invalida', 20), observedAt: 'también-inválida' },
    ], { now: new Date('2026-08-10T22:00:00.000Z') });

    expect(result.availability).toBe('NO_DISPONIBLE');
    expect(result.currentLevel).toBeNull();
    expect(result.regime).toBeNull();
    expect(result.score).toBeNull();
    expect(result.vote).toBe('NO_VOTE');
  });
});

describe('conservative risk-on identification', () => {
  it('reconoce solo aliases explícitos y no altera una decisión', () => {
    expect(isConservativeRiskOnAsset('TVC:SPX')).toBe(true);
    expect(isConservativeRiskOnAsset('NASDAQ:NDX')).toBe(true);
    expect(isConservativeRiskOnAsset('BTC/USD')).toBe(true);
    expect(isConservativeRiskOnAsset('EUR/USD')).toBe(false);
    expect(isConservativeRiskOnAsset('XAUUSD')).toBe(false);
    expect(isConservativeRiskOnAsset('CBOE:VIX')).toBe(false);
  });
});
