import { describe, expect, it } from 'vitest';
import { EDGAR_REFRESH_TTL_MS, SESSION_METRICS_REFRESH_TTL_MS, shouldRequestForTicker } from './tickerRefreshPolicy';

describe('política de refresco por ticker', () => {
  it('no consulta sin una acción en foco', () => {
    expect(shouldRequestForTicker(null, null, 0, EDGAR_REFRESH_TTL_MS)).toBe(false);
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:0 }, null, 1_000_000, EDGAR_REFRESH_TTL_MS)).toBe(false);
  });

  it('consulta la primera vez', () => {
    expect(shouldRequestForTicker(null, 'AAPL', 0, EDGAR_REFRESH_TTL_MS)).toBe(true);
  });

  it('consulta de inmediato al cambiar de acción', () => {
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:1000 }, 'MSFT', 1001, EDGAR_REFRESH_TTL_MS)).toBe(true);
  });

  it('no repite la misma acción dentro del TTL', () => {
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:0 }, 'AAPL', EDGAR_REFRESH_TTL_MS - 1, EDGAR_REFRESH_TTL_MS)).toBe(false);
  });

  it('vuelve a consultar pasado el TTL, para ver los 8-K del día', () => {
    // Este es el fallo que corrige: antes no volvía a pedirlo nunca.
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:0 }, 'AAPL', EDGAR_REFRESH_TTL_MS, EDGAR_REFRESH_TTL_MS)).toBe(true);
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:0 }, 'AAPL', EDGAR_REFRESH_TTL_MS * 4, EDGAR_REFRESH_TTL_MS)).toBe(true);
  });

  it('reconsulta si el registro anterior está corrupto', () => {
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:Number.NaN }, 'AAPL', 5000, EDGAR_REFRESH_TTL_MS)).toBe(true);
  });

  it('acepta un TTL propio', () => {
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:0 }, 'AAPL', 500, 1000)).toBe(false);
    expect(shouldRequestForTicker({ ticker:'AAPL', requestedAt:0 }, 'AAPL', 1000, 1000)).toBe(true);
  });
});

describe('TTL por consumidor', () => {
  it('VWAP se refresca mucho más seguido que EDGAR', () => {
    // Un mismo ticker consultado hace 3 minutos: EDGAR aún vale, el VWAP ya no.
    const previous = { ticker:'AAPL', requestedAt:0 };
    const threeMinutes = 3 * 60 * 1000;
    expect(shouldRequestForTicker(previous, 'AAPL', threeMinutes, EDGAR_REFRESH_TTL_MS)).toBe(false);
    expect(shouldRequestForTicker(previous, 'AAPL', threeMinutes, SESSION_METRICS_REFRESH_TTL_MS)).toBe(true);
  });
});
