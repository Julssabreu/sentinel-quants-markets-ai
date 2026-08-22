import { describe, expect, it } from 'vitest';
import { EDGAR_REFRESH_TTL_MS, shouldRequestEdgar } from './edgarRefreshPolicy';

describe('política de refresco de EDGAR', () => {
  it('no consulta sin una acción en foco', () => {
    expect(shouldRequestEdgar(null, null, 0)).toBe(false);
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:0 }, null, 1_000_000)).toBe(false);
  });

  it('consulta la primera vez', () => {
    expect(shouldRequestEdgar(null, 'AAPL', 0)).toBe(true);
  });

  it('consulta de inmediato al cambiar de acción', () => {
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:1000 }, 'MSFT', 1001)).toBe(true);
  });

  it('no repite la misma acción dentro del TTL', () => {
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:0 }, 'AAPL', EDGAR_REFRESH_TTL_MS - 1)).toBe(false);
  });

  it('vuelve a consultar pasado el TTL, para ver los 8-K del día', () => {
    // Este es el fallo que corrige: antes no volvía a pedirlo nunca.
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:0 }, 'AAPL', EDGAR_REFRESH_TTL_MS)).toBe(true);
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:0 }, 'AAPL', EDGAR_REFRESH_TTL_MS * 4)).toBe(true);
  });

  it('reconsulta si el registro anterior está corrupto', () => {
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:Number.NaN }, 'AAPL', 5000)).toBe(true);
  });

  it('acepta un TTL propio', () => {
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:0 }, 'AAPL', 500, 1000)).toBe(false);
    expect(shouldRequestEdgar({ ticker:'AAPL', requestedAt:0 }, 'AAPL', 1000, 1000)).toBe(true);
  });
});
