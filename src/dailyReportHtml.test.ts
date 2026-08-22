import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { buildDailyReportHtml, riskRewardOf, convictionFromGovernance } from '../shared/dailyReportHtml.cjs';

const base = {
  generatedAtIso: '2026-08-22T13:00:00.000Z',
  candidates: [], deepDive: [], vix: null, macro: null, stockDetails: {},
};

describe('riskRewardOf', () => {
  it('calcula R:R desde el plan real', () => {
    expect(riskRewardOf({ maxEntry: 100, stop: 98, tp1: 104 })).toBeCloseTo(2, 10);
  });
  it('devuelve null si el riesgo es cero o negativo, en vez de dividir por cero', () => {
    expect(riskRewardOf({ maxEntry: 100, stop: 100, tp1: 104 })).toBeNull();
    expect(riskRewardOf(null)).toBeNull();
  });
});

describe('convictionFromGovernance', () => {
  it('declara RESEARCH sin autorización cuando la muestra es insuficiente', () => {
    const result = convictionFromGovernance({ maturityStatus: 'RESEARCH', maturitySample: 7 });
    expect(result.label).toContain('RESEARCH');
    expect(result.detail).toContain('7/30');
  });
  it('reconoce evidencia solo con muestra completa y estado maduro', () => {
    const result = convictionFromGovernance({ maturityStatus: 'ACTIVE', maturitySample: 30 });
    expect(result.label).toBe('Con evidencia');
  });
});

describe('buildDailyReportHtml', () => {
  it('nunca escapa a XSS: un símbolo malicioso no rompe el HTML', () => {
    const html = buildDailyReportHtml({
      ...base,
      candidates: [{ symbol: '<script>alert(1)</script>', market: 'STOCK', direction: 'BUY', score: 90, description: 'x' }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('declara VIX no disponible en vez de omitir la sección', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toContain('VIX:</strong> Dato no disponible');
  });

  it('muestra el nivel de VIX cuando existe', () => {
    const html = buildDailyReportHtml({ ...base, vix: { value: 15.01, observedAt: '2026-08-22T13:00:00Z', source: 'TradingView' } });
    expect(html).toContain('15.01');
  });

  it('un candidato sin registro SMC no inventa niveles', () => {
    const html = buildDailyReportHtml({
      ...base,
      deepDive: [{ candidate: { symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple' }, record: null }],
    });
    expect(html).toContain('Sin análisis SMC guardado hoy');
    expect(html).not.toContain('R:R');
  });

  it('un candidato con registro SMC muestra entrada, stop, objetivos y R:R', () => {
    const html = buildDailyReportHtml({
      ...base,
      deepDive: [{
        candidate: { symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple' },
        record: {
          analyticalDecision: 'BUY_CONDICIONADO', regime: 'ALCISTA', strategy: 'SMC_D1_H4_H1_M15_M5_V1',
          technicalConfidence: 78, dataQualityScore: 100, maturityStatus: 'RESEARCH', maturitySample: 5,
          authorizationReasons: ['H4 no alcanza la zona estructural.'],
          plan: { trigger: 100, maxEntry: 100.5, stop: 98, tp1: 104, tp2: 108 },
          sources: ['MetaTrader 5 local terminal', 'TradingView / Cloudflare'],
        },
      }],
    });
    expect(html).toContain('BUY_CONDICIONADO');
    expect(html).toContain('100.5000');
    expect(html).toContain('98.0000');
    // riesgo = |100.5-98| = 2.5; recompensa = |104-100.5| = 3.5; R:R = 1.4
    expect(html).toContain('1.40 : 1');
  });

  it('separa correctamente el análisis destacado del resto de candidatos', () => {
    const html = buildDailyReportHtml({
      ...base,
      candidates: [
        { symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple' },
        { symbol: 'EUR/USD', market: 'FOREX', direction: 'SELL', score: 70, description: 'Euro' },
      ],
      deepDive: [{ candidate: { symbol: 'AAPL.US', market: 'STOCK', direction: 'BUY', score: 91, description: 'Apple' }, record: null }],
    });
    // AAPL.US aparece en el análisis destacado, no debe repetirse en la tabla resumen.
    const summaryTableStart = html.indexOf('Resto de candidatos');
    expect(html.slice(summaryTableStart)).not.toContain('AAPL.US');
    expect(html.slice(summaryTableStart)).toContain('EUR/USD');
  });

  it('siempre declara sus propios límites, incluido que ninguna IA origina el dato', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toContain('consenso de analistas');
    expect(html).toContain('ninguna IA origina un dato');
  });

  it('convierte el timestamp a AST y a ET', () => {
    const html = buildDailyReportHtml({ ...base, generatedAtIso: '2026-08-22T13:00:00.000Z' });
    expect(html).toMatch(/09:00 AST/);
    expect(html).toMatch(/09:00 ET/);
  });
});
