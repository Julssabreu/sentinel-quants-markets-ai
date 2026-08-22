import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { composeDailyReportText } from '../shared/dailyReportComposer.cjs';

const base = { generatedAtIso: '2026-08-22T13:00:00.000Z', candidates: [] };

describe('composeDailyReportText (vista previa de WhatsApp)', () => {
  it('declara explícitamente cuando el escáner no encontró nada', () => {
    const text = composeDailyReportText(base);
    expect(text).toContain('no encontró candidatos');
    expect(text).not.toContain('undefined');
  });

  it('lista una vista previa corta, con dirección traducida y score', () => {
    const text = composeDailyReportText({
      ...base,
      candidates: [
        { symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple Inc.' },
        { symbol: 'EUR/USD', market: 'FOREX', direction: 'SELL', score: 78, description: 'Euro/Dólar' },
      ],
    });
    expect(text).toContain('AAPL.US (STOCK) COMPRA · score 91');
    expect(text).toContain('EUR/USD (FOREX) VENTA · score 78');
  });

  it('recorta a maxCandidates (3 por defecto) pero declara el total real', () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({ symbol: `T${i}`, market: 'STOCK', direction: 'BUY', score: 50, description: 'x' }));
    const text = composeDailyReportText({ ...base, candidates });
    expect(text).toContain('Vista previa (3 de 8 candidatos verificables)');
    expect(text).not.toContain('T3');
  });

  it('remite al PDF adjunto para el detalle, en vez de duplicarlo en el texto', () => {
    const text = composeDailyReportText({
      ...base,
      candidates: [{ symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple Inc.' }],
    });
    expect(text).toContain('van en el PDF adjunto');
    // El texto solo debe MENCIONAR que hay VWAP/EDGAR en el PDF, no repetir sus datos.
    expect(text).not.toMatch(/VWAP: \d/);
    expect(text).not.toContain('SEC EDGAR:');
  });

  it('siempre cierra con el recordatorio de que Sentinel no ejecuta', () => {
    expect(composeDailyReportText(base)).toContain('no ejecuta. La decisión final es tuya.');
  });

  it('convierte la fecha a hora de Santo Domingo (AST)', () => {
    const text = composeDailyReportText({ ...base, generatedAtIso: '2026-08-22T13:00:00.000Z' });
    expect(text).toMatch(/09:00 AST/);
  });
});
