import { describe, expect, it, vi } from 'vitest';
import { buildStockSessionMetrics, OPENING_RANGE_MINUTES } from './sessionMetricsFetch';

// 13:30 UTC cae en REGULAR para acciones (9:30 ET en horario de verano).
const REGULAR_SESSION_OPEN = Date.UTC(2026, 7, 24, 13, 30); // lunes
const candle = (minute: number, o: number, h: number, l: number, c: number, realVolume = 1000) => ({
  time: new Date(REGULAR_SESSION_OPEN + minute * 60_000).toISOString(),
  open: o, high: h, low: l, close: c, realVolume,
});

describe('buildStockSessionMetrics', () => {
  it('no calcula fuera de la sesión regular, para no reconstruir la apertura a ciegas', async () => {
    const fetchRates = vi.fn();
    const outsideRegular = new Date(Date.UTC(2026, 7, 24, 4, 0)); // madrugada UTC, ASIA/CLOSED para acciones
    const result = await buildStockSessionMetrics(fetchRates, 'AAPL.US', outsideRegular);
    expect(result.vwap).toBeNull();
    expect(result.openingRange).toBeNull();
    expect(result.unavailableReason).toContain('sesión regular');
    expect(fetchRates).not.toHaveBeenCalled();
  });

  it('pide velas M1 desde la apertura, con margen, y calcula VWAP y opening range', async () => {
    const now = new Date(REGULAR_SESSION_OPEN + 20 * 60_000); // 20 min tras la apertura
    const candles = Array.from({ length: 21 }, (_, i) => candle(i, 100 + i * 0.1, 100 + i * 0.1 + 0.5, 100 + i * 0.1 - 0.5, 100 + i * 0.1));
    const fetchRates = vi.fn().mockResolvedValue({ ok: true, candles });

    const result = await buildStockSessionMetrics(fetchRates, 'AAPL.US', now);

    expect(fetchRates).toHaveBeenCalledWith('AAPL.US', 'M1', 25); // 20 minutos + 5 de margen
    expect(result.vwap).not.toBeNull();
    expect(result.vwap?.basis).toBe('REAL_VOLUME');
    expect(result.openingRange).not.toBeNull();
    expect(result.unavailableReason).toBeNull();
  });

  it('usa la ventana de opening range declarada (ORB15)', async () => {
    const now = new Date(REGULAR_SESSION_OPEN + 30 * 60_000);
    // Vela 20 rompe muy por encima; si la ventana fuera mayor a 15 min, se colaría en el rango.
    const candles = [
      ...Array.from({ length: 15 }, (_, i) => candle(i, 100, 101, 99, 100)),
      candle(20, 100, 150, 100, 150),
    ];
    const fetchRates = vi.fn().mockResolvedValue({ ok: true, candles });
    const result = await buildStockSessionMetrics(fetchRates, 'AAPL.US', now);
    expect(OPENING_RANGE_MINUTES).toBe(15);
    expect(result.openingRange?.high).toBe(101);
    expect(result.openingRange?.breakout).toBe('ABOVE');
  });

  it('informa el motivo cuando MT5 no responde OK, en vez de fingir datos', async () => {
    const now = new Date(REGULAR_SESSION_OPEN + 10 * 60_000);
    const fetchRates = vi.fn().mockResolvedValue({ ok: false, error: 'Símbolo no resuelto.' });
    const result = await buildStockSessionMetrics(fetchRates, 'ZZZZ.US', now);
    expect(result.vwap).toBeNull();
    expect(result.unavailableReason).toContain('Símbolo no resuelto');
  });

  it('sin volumen, pierde el VWAP pero conserva el opening range', async () => {
    // El opening range es solo máx/mín: no depende de volumen. Perder uno no debe
    // apagar el otro, y con datos parciales no hay un unico "motivo" que reportar.
    const now = new Date(REGULAR_SESSION_OPEN + 10 * 60_000);
    const candles = Array.from({ length: 11 }, (_, i) => candle(i, 100, 101, 99, 100, 0));
    candles.forEach(bar => { (bar as { tickVolume?: number }).tickVolume = 0; });
    const fetchRates = vi.fn().mockResolvedValue({ ok: true, candles });
    const result = await buildStockSessionMetrics(fetchRates, 'AAPL.US', now);
    expect(result.vwap).toBeNull();
    expect(result.openingRange).not.toBeNull();
    expect(result.unavailableReason).toBeNull();
  });

  it('informa el motivo cuando ni VWAP ni opening range son calculables', async () => {
    const now = new Date(REGULAR_SESSION_OPEN + 10 * 60_000);
    // Ventana consultada vacía: MT5 respondió ok pero sin velas dentro del rango pedido.
    const fetchRates = vi.fn().mockResolvedValue({ ok: true, candles: [candle(-500, 100, 101, 99, 100)] });
    const result = await buildStockSessionMetrics(fetchRates, 'AAPL.US', now);
    expect(result.vwap).toBeNull();
    expect(result.openingRange).toBeNull();
    expect(result.unavailableReason).toContain('Datos insuficientes');
  });

  it('captura un rechazo de la promesa en vez de propagarlo', async () => {
    const now = new Date(REGULAR_SESSION_OPEN + 10 * 60_000);
    const fetchRates = vi.fn().mockRejectedValue(new Error('IPC caído'));
    const result = await buildStockSessionMetrics(fetchRates, 'AAPL.US', now);
    expect(result.unavailableReason).toContain('IPC caído');
  });
});
