import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { composeDailyReportText } from '../shared/dailyReportComposer.cjs';

const base = { generatedAtIso: '2026-08-22T13:00:00.000Z', candidates: [], stockDetails: {} };

describe('composeDailyReportText', () => {
  it('declara explícitamente cuando el escáner no encontró nada, en vez de omitir la sección', () => {
    const text = composeDailyReportText(base);
    expect(text).toContain('no encontró candidatos');
    expect(text).not.toContain('undefined');
  });

  it('lista los candidatos con dirección traducida y score', () => {
    const text = composeDailyReportText({
      ...base,
      candidates: [
        { symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple Inc.' },
        { symbol: 'EUR/USD', market: 'FOREX', direction: 'SELL', score: 78, description: 'Euro/Dólar' },
      ],
    });
    expect(text).toContain('AAPL.US (STOCK) COMPRA · score 91 — Apple Inc.');
    expect(text).toContain('EUR/USD (FOREX) VENTA · score 78 — Euro/Dólar');
  });

  it('recorta a maxCandidates pero declara el total real', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({ symbol: `T${i}`, market: 'STOCK', direction: 'BUY', score: 50, description: 'x' }));
    const text = composeDailyReportText({ ...base, candidates, maxCandidates: 3 });
    expect(text).toContain('Candidatos del escáner (3 de 8)');
    expect(text).not.toContain('T3');
  });

  it('añade VWAP, opening range y EDGAR solo para el símbolo que los tiene', () => {
    const text = composeDailyReportText({
      ...base,
      candidates: [{ symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple Inc.' }],
      stockDetails: {
        'AAPL.US': {
          sessionMetrics: {
            vwap: { value: 187.325, basis: 'REAL_VOLUME' },
            openingRange: { low: 185.1, high: 188.4, breakout: 'ABOVE' },
          },
          edgar: { error: null, filings: [{ form: '10-Q', filingDate: '2026-07-31', documentUrl: 'https://x' }] },
        },
      },
    });
    expect(text).toContain('VWAP: 187.3250 (volumen real)');
    expect(text).toContain('Rango de apertura: 185.1000–188.4000 (ruptura al alza confirmada)');
    expect(text).toContain('SEC EDGAR: 1 presentaciones recientes; última 10-Q (2026-07-31)');
  });

  it('declara el VWAP proxy como proxy, no como institucional', () => {
    const text = composeDailyReportText({
      ...base,
      candidates: [{ symbol: 'BTC/USD', market: 'CRYPTO', direction: 'BUY', score: 80, description: 'Bitcoin' }],
      stockDetails: { 'BTC/USD': { sessionMetrics: { vwap: { value: 78000, basis: 'TICK_VOLUME' }, openingRange: null }, edgar: null } },
    });
    expect(text).toContain('proxy de ticks — no institucional');
  });

  it('omite silenciosamente el detalle ausente en vez de imprimir null/undefined', () => {
    const text = composeDailyReportText({
      ...base,
      candidates: [{ symbol: 'XAU/USD', market: 'METAL', direction: 'SELL', score: 60, description: 'Oro' }],
      stockDetails: { 'XAU/USD': { sessionMetrics: null, edgar: { error: 'HTTP 403', filings: [] } } },
    });
    expect(text).not.toContain('VWAP');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('siempre cierra con el recordatorio de que Sentinel no ejecuta', () => {
    expect(composeDailyReportText(base)).toContain('no ejecuta. La decisión final es tuya.');
  });

  it('convierte la fecha a hora de Santo Domingo (AST)', () => {
    // 13:00 UTC = 9:00 AST (UTC-4, sin horario de verano).
    const text = composeDailyReportText({ ...base, generatedAtIso: '2026-08-22T13:00:00.000Z' });
    expect(text).toMatch(/09:00 AST/);
  });
});
