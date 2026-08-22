import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { buildDailyReportHtml, previousRegularSessionCloseDate } from '../shared/dailyReportHtml.cjs';

const base = {
  generatedAtIso: '2026-08-22T13:00:00.000Z',
  extendedHoursSource: { connected: false, brokerName: null },
  vix: null, macro: null, catalysts: [], stocks: [],
};

describe('buildDailyReportHtml (premercado y posmercado — solo acciones)', () => {
  it('nunca escapa a XSS: un símbolo malicioso no rompe el HTML', () => {
    const html = buildDailyReportHtml({
      ...base,
      stocks: [{ symbol: '<script>alert(1)</script>', direction: 'BUY', score: 90, description: 'x' }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('declara explícitamente cuando no hay fuente de horario extendido conectada', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toContain('Premercado y after-hours: dato no disponible');
    expect(html).toContain('TradeStation o Interactive Brokers');
  });

  it('omite el aviso de horario extendido cuando sí hay fuente conectada', () => {
    const html = buildDailyReportHtml({ ...base, extendedHoursSource: { connected: true, brokerName: 'TradeStation' } });
    expect(html).not.toContain('Premercado y after-hours: dato no disponible');
  });

  it('declara VIX no disponible en vez de omitir la sección', () => {
    expect(buildDailyReportHtml(base)).toContain('VIX:</strong> Dato no disponible');
  });

  it('muestra el nivel de VIX cuando existe', () => {
    const html = buildDailyReportHtml({ ...base, vix: { value: 15.01, observedAt: '2026-08-22T13:00:00Z', source: 'TradingView' } });
    expect(html).toContain('15.01');
  });

  it('lista catalizadores reales de SEC EDGAR con enlace al documento original', () => {
    const html = buildDailyReportHtml({
      ...base,
      catalysts: [{
        ticker: 'AAPL', companyName: 'Apple Inc.', error: null,
        filings: [{ form: '10-Q', filingDate: '2026-07-31', documentUrl: 'https://www.sec.gov/x.htm' }],
      }],
    });
    expect(html).toContain('Apple Inc.');
    expect(html).toContain('10-Q');
    expect(html).toContain('https://www.sec.gov/x.htm');
  });

  it('un ticker sin presentaciones o con error de EDGAR no aparece en la tabla de catalizadores', () => {
    const html = buildDailyReportHtml({
      ...base,
      catalysts: [
        { ticker: 'ZZZZ', companyName: null, error: 'HTTP 403', filings: [] },
        { ticker: 'YYYY', companyName: 'Sin filings', error: null, filings: [] },
      ],
    });
    expect(html).toContain('Sin presentaciones recientes');
    expect(html).not.toContain('ZZZZ');
    expect(html).not.toContain('YYYY');
  });

  it('nunca inventa consenso de analistas ni datos de premercado', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toContain('consenso de analistas');
    expect(html).toContain('ninguna IA origina un dato');
  });

  it('el universo de acciones aclara que es sesión regular, no premercado', () => {
    const html = buildDailyReportHtml({
      ...base,
      stocks: [{ symbol: 'AAPL.US', direction: 'BUY', score: 91, description: 'Apple' }],
    });
    expect(html).toContain('No es una lectura de premercado');
    expect(html).toContain('AAPL.US');
    expect(html).toContain('ALCISTA');
  });

  it('convierte el timestamp a AST y a ET', () => {
    const html = buildDailyReportHtml({ ...base, generatedAtIso: '2026-08-22T13:00:00.000Z' });
    expect(html).toMatch(/09:00 AST/);
    expect(html).toMatch(/09:00 ET/);
  });
});

describe('previousRegularSessionCloseDate — fin de semana lee el viernes', () => {
  // El informe corre todos los días del calendario, incluido lunes. "El cierre
  // regular anterior" el lunes debe ser el del viernes, no el de un domingo que
  // nunca existió como sesión.
  it('un martes a viernes, el cierre anterior es el día calendario previo', () => {
    // Miércoles 2026-08-19 09:00 AST -> martes 2026-08-18
    expect(previousRegularSessionCloseDate(new Date('2026-08-19T13:00:00.000Z'))).toContain('18 de agosto');
  });

  it('un lunes, el cierre regular anterior es el viernes, no el domingo', () => {
    // Lunes 2026-08-24 09:00 AST -> viernes 2026-08-21
    expect(previousRegularSessionCloseDate(new Date('2026-08-24T13:00:00.000Z'))).toContain('21 de agosto');
  });

  it('un sábado, el cierre regular anterior sigue siendo el viernes', () => {
    // Sábado 2026-08-22 09:00 AST -> viernes 2026-08-21
    expect(previousRegularSessionCloseDate(new Date('2026-08-22T13:00:00.000Z'))).toContain('21 de agosto');
  });

  it('un domingo, el cierre regular anterior también es el viernes', () => {
    // Domingo 2026-08-23 09:00 AST -> viernes 2026-08-21
    expect(previousRegularSessionCloseDate(new Date('2026-08-23T13:00:00.000Z'))).toContain('21 de agosto');
  });

  it('el informe generado en HTML el lunes menciona el viernes, no el domingo', () => {
    const html = buildDailyReportHtml({ ...base, generatedAtIso: '2026-08-24T13:00:00.000Z' });
    expect(html).toContain('21 de agosto');
    expect(html).not.toContain('23 de agosto');
  });
});
