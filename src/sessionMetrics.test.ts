import { describe, expect, it } from 'vitest';
import type { Candle } from './analysisEngine';
import { calculateOpeningRange, calculateVwap, resolveVolumeBasis } from './sessionMetrics';

function bar(minute: number, open: number, high: number, low: number, close: number, extra: Partial<Candle> = {}): Candle {
  return {
    time: new Date(Date.UTC(2026, 7, 21, 13, 30 + minute)).toISOString(),
    open, high, low, close, ...extra,
  };
}

describe('VWAP', () => {
  it('promedia el precio típico ponderado por volumen real', () => {
    // Precio típico 10 con volumen 100, y 20 con volumen 300 → (1000+6000)/400 = 17.5
    const candles = [
      bar(0, 10, 10, 10, 10, { realVolume: 100 }),
      bar(1, 20, 20, 20, 20, { realVolume: 300 }),
    ];
    const result = calculateVwap(candles);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.value).toBe(17.5);
    expect(result.data.basis).toBe('REAL_VOLUME');
    expect(result.data.cumulativeVolume).toBe(400);
    expect(result.data.closeDistance).toBe(2.5);
  });

  it('declara el proxy cuando el bróker no entrega volumen real', () => {
    const candles = [
      bar(0, 10, 10, 10, 10, { realVolume: 0, tickVolume: 50 }),
      bar(1, 20, 20, 20, 20, { realVolume: 0, tickVolume: 50 }),
    ];
    const result = calculateVwap(candles);
    expect(result.ok).toBe(true);
    // No debe presentarse como VWAP institucional: en CFDs el volumen real es cero.
    if (result.ok) expect(result.data.basis).toBe('TICK_VOLUME');
  });

  it('no usa volumen real si la serie es mixta, porque sería incomparable', () => {
    expect(resolveVolumeBasis([
      bar(0, 10, 10, 10, 10, { realVolume: 100, tickVolume: 10 }),
      bar(1, 20, 20, 20, 20, { realVolume: 0, tickVolume: 10 }),
    ])).toBe('TICK_VOLUME');
  });

  it('se declara no calculable en vez de inventar un valor sin volumen', () => {
    const result = calculateVwap([bar(0, 10, 11, 9, 10)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_VOLUME');
  });

  it('ancla el acumulado y descarta lo anterior a la apertura', () => {
    const candles = [
      bar(0, 5, 5, 5, 5, { realVolume: 1000 }),
      bar(1, 10, 10, 10, 10, { realVolume: 100 }),
      bar(2, 20, 20, 20, 20, { realVolume: 300 }),
    ];
    const anchored = calculateVwap(candles, { anchorTime: bar(1, 0, 0, 0, 0).time });
    expect(anchored.ok).toBe(true);
    // La vela de las 13:30 con volumen 1000 quedaría fuera: sin ancla dominaría todo.
    if (anchored.ok) {
      expect(anchored.data.value).toBe(17.5);
      expect(anchored.data.bars).toBe(2);
    }
  });

  it('informa cuando no hay velas después del ancla', () => {
    const result = calculateVwap([bar(0, 10, 10, 10, 10, { realVolume: 5 })], {
      anchorTime: new Date(Date.UTC(2026, 7, 22)).toISOString(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_BARS_IN_WINDOW');
  });
});

describe('opening range', () => {
  const session = [
    bar(0, 100, 105, 99, 104),
    bar(1, 104, 106, 103, 105),
    bar(2, 105, 107, 104, 106),
    bar(30, 106, 108, 105, 107),
  ];

  it('toma máximo y mínimo solo de la ventana de apertura', () => {
    const result = calculateOpeningRange(session, { openTime: session[0].time, minutes: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // La vela del minuto 30 queda fuera: su máximo de 108 no debe entrar en el rango.
    expect(result.data.high).toBe(107);
    expect(result.data.low).toBe(99);
    expect(result.data.width).toBe(8);
    expect(result.data.bars).toBe(3);
  });

  it('confirma la ruptura por cierre y solo después de la ventana', () => {
    const result = calculateOpeningRange(session, { openTime: session[0].time, minutes: 15 });
    expect(result.ok).toBe(true);
    // El cierre de 107 iguala el máximo, no lo supera: no hay ruptura.
    if (result.ok) expect(result.data.breakout).toBeNull();

    const breakout = calculateOpeningRange(
      [...session, bar(31, 107, 112, 107, 111)],
      { openTime: session[0].time, minutes: 15 },
    );
    if (breakout.ok) {
      expect(breakout.data.breakout).toBe('ABOVE');
      expect(breakout.data.position).toBe('ABOVE');
    }
  });

  it('no cuenta como ruptura una mecha que no cierra fuera', () => {
    const result = calculateOpeningRange(
      [...session, bar(31, 107, 115, 106, 106)],
      { openTime: session[0].time, minutes: 15 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.breakout).toBeNull();
  });

  it('informa cuando no hay velas en la ventana en vez de estimarla', () => {
    const result = calculateOpeningRange(session, {
      openTime: new Date(Date.UTC(2026, 7, 22, 13, 30)).toISOString(),
      minutes: 15,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NO_BARS_IN_WINDOW');
  });
});
