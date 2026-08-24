import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { buildDailyReportHtml, deriveBias } from '../shared/dailyReportHtml.cjs';

const base = {
  generatedAtIso: '2026-08-24T13:00:00.000Z',
  previousSessionDate: '2026-08-21',
  sessionDate: '2026-08-21',
  extendedHoursSource: { connected: true, brokerName: 'Massive' },
  indices: [], movers: [], catalysts: [], news: [], macro: null, vix: null, marketHolidays: [],
};

const index = (ticker: string, premarketPct: number, close = 100) => ({
  ticker,
  previousRegular: { last: close, changePercent: -0.3 },
  premarket: { last: close * (1 + premarketPct / 100), changePercent: premarketPct },
});

describe('deriveBias — sesgo leído del dato, no opinado', () => {
  it('sin índices no declara ningún sesgo', () => {
    expect(deriveBias([]).label).toContain('Sin datos');
  });

  it('declara defensivo cuando los proxies caen', () => {
    expect(deriveBias([index('SPY', -0.5), index('QQQ', -1.3)]).label).toBe('Defensivo');
  });

  it('declara constructivo cuando los proxies suben', () => {
    expect(deriveBias([index('SPY', 0.6), index('QQQ', 0.7)]).label).toBe('Constructivo');
  });

  it('declara mixto en el rango intermedio', () => {
    expect(deriveBias([index('SPY', 0.1), index('QQQ', -0.1)]).label).toContain('Mixto');
  });

  it('detecta rezago del Nasdaq frente al S&P 500', () => {
    const bias = deriveBias([index('SPY', -0.1), index('QQQ', -1.3)]);
    expect(bias.detail).toContain('Nasdaq va rezagado');
  });

  it('no inventa rezago cuando ambos van parejos', () => {
    expect(deriveBias([index('SPY', 0.1), index('QQQ', 0.1)]).detail).not.toContain('rezagado');
  });
});

describe('buildDailyReportHtml', () => {
  it('nunca escapa a XSS', () => {
    const html = buildDailyReportHtml({ ...base, movers: [{
      ticker: '<script>alert(1)</script>', previousClose: 10,
      premarket: { last: 11, high: 11, low: 10, bars: 5, changePercent: 10 }, afterHours: null,
    }] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('incluye las siete secciones del informe de referencia', () => {
    const html = buildDailyReportHtml(base);
    for (const heading of [
      '1. Estado del mercado',
      '2. Macro y riesgo de sesión',
      '3. Movimientos del premercado',
      '4. Posmercado',
      '5. Noticias del universo observado',
      '6. Disciplina de apertura',
      '7. Fuentes y metodología',
    ]) expect(html).toContain(heading);
  });

  it('muestra cierre previo y premercado de los índices con su nombre', () => {
    const html = buildDailyReportHtml({ ...base, indices: [index('SPY', -0.49, 745.06), index('QQQ', -1.3)] });
    expect(html).toContain('S&amp;P 500');
    expect(html).toContain('Nasdaq 100');
    expect(html).toContain('-0.49%');
    expect(html).toContain('-1.30%');
  });

  it('ordena los movers por movimiento absoluto, no por signo', () => {
    const html = buildDailyReportHtml({ ...base, movers: [
      { ticker: 'SUBE', previousClose: 100, premarket: { last: 103, high:103, low:100, bars:10, changePercent: 3 }, afterHours: null },
      { ticker: 'CAE', previousClose: 100, premarket: { last: 93, high:100, low:93, bars:10, changePercent: -7 }, afterHours: null },
    ] });
    expect(html.indexOf('CAE')).toBeLessThan(html.indexOf('SUBE'));
  });

  it('un mover sin datos de una ventana no aparece en esa tabla', () => {
    const html = buildDailyReportHtml({ ...base, movers: [
      { ticker: 'SOLOPRE', previousClose: 100, premarket: { last: 103, high:103, low:100, bars:10, changePercent: 3 }, afterHours: null },
    ] });
    expect(html).toContain('SOLOPRE');
    expect(html).toContain('Sin operaciones registradas en after-hours');
  });

  it('lista noticias con editorial y enlace verificable', () => {
    const html = buildDailyReportHtml({ ...base, news: [
      { title: 'Apple sube tras resultados', publisher: 'Reuters', url: 'https://x.com/a', publishedAt: '2026-08-24T10:00:00Z', tickers: ['AAPL'] },
    ] });
    expect(html).toContain('Apple sube tras resultados');
    expect(html).toContain('Reuters');
    expect(html).toContain('https://x.com/a');
  });

  it('filtra los rendimientos del bloque macro', () => {
    const html = buildDailyReportHtml({ ...base, macro: { indicators: [
      { name: 'Rendimiento del Tesoro a 10 años', value: 4.75, unit: '%', source: 'Treasury' },
      { name: 'Precio del pan', value: 3, unit: 'USD', source: 'Irrelevante' },
    ] } });
    expect(html).toContain('Rendimiento del Tesoro a 10 años');
    expect(html).not.toContain('Precio del pan');
  });

  it('muestra próximos cierres del mercado cuando existen', () => {
    const html = buildDailyReportHtml({ ...base, marketHolidays: [
      { date: '2026-09-07', name: 'Labor Day', status: 'closed' },
    ] });
    expect(html).toContain('Labor Day');
    expect(html).toContain('2026-09-07');
  });

  it('declara explícitamente que no tiene consenso de analistas', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toContain('No incluye consenso ni objetivos de precio de analistas');
    expect(html).toContain('ninguna IA origina un dato');
  });

  it('avisa cuando no hay fuente de horario extendido conectada', () => {
    const html = buildDailyReportHtml({ ...base, extendedHoursSource: { connected: false, brokerName: null } });
    expect(html).toContain('Premercado y after-hours: dato no disponible');
  });

  it('convierte el corte de datos a AST y ET', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toMatch(/09:00 hora de República Dominicana/);
    expect(html).toMatch(/09:00 ET/);
  });

  it('declara que cubre la última sesión completa, no el premercado de hoy', () => {
    // Sin esta advertencia el lector podría leer un premercado del viernes creyendo
    // que es el de hoy — el peor malentendido posible en un informe de mercado.
    const html = buildDailyReportHtml(base);
    expect(html).toContain('describe la última sesión completa, no el premercado de hoy');
    expect(html).toContain('plan de pago');
  });

  it('nombra la sesión cubierta en el alcance y en las secciones', () => {
    const html = buildDailyReportHtml(base);
    expect(html).toContain('sesión completa del 2026-08-21');
    expect(html).toContain('Premercado del 2026-08-21');
    expect(html).toContain('Posmercado — 2026-08-21');
  });
});
