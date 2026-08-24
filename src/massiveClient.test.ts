import { describe, expect, it, vi } from 'vitest';
import {
  createMassiveClient, newYorkTimeToUtcMs, sessionWindowsForDate, splitSessions, summarizeWindow,
  lastTwoSessionDates, selectAdaptiveUniverse, normalizeNewsItem,
  // @ts-expect-error CommonJS shared production module
} from '../shared/massiveClient.cjs';

/** Barra de un minuto en el formato que devuelve Massive (t = ms UTC). */
const bar = (iso: string, close: number, extra: Partial<{ o:number; h:number; l:number; v:number }> = {}) => ({
  t: Date.parse(iso), o: extra.o ?? close, h: extra.h ?? close, l: extra.l ?? close, c: close, v: extra.v ?? 1000,
});

describe('fronteras de sesión con zona horaria real', () => {
  it('en verano (EDT, UTC-4) la apertura regular es 13:30 UTC', () => {
    expect(newYorkTimeToUtcMs('2026-08-21', 9, 30)).toBe(Date.parse('2026-08-21T13:30:00Z'));
  });

  it('en invierno (EST, UTC-5) la misma apertura es 14:30 UTC', () => {
    // Este es el caso que un offset fijo rompería: la ventana se correría una hora.
    expect(newYorkTimeToUtcMs('2026-01-15', 9, 30)).toBe(Date.parse('2026-01-15T14:30:00Z'));
  });

  it('el premercado abre a las 04:00 ET en ambas estaciones', () => {
    expect(newYorkTimeToUtcMs('2026-08-21', 4, 0)).toBe(Date.parse('2026-08-21T08:00:00Z'));
    expect(newYorkTimeToUtcMs('2026-01-15', 4, 0)).toBe(Date.parse('2026-01-15T09:00:00Z'));
  });

  it('sessionWindowsForDate devuelve las cuatro fronteras ordenadas', () => {
    const w = sessionWindowsForDate('2026-08-21');
    expect(w.premarketOpen).toBeLessThan(w.regularOpen);
    expect(w.regularOpen).toBeLessThan(w.regularClose);
    expect(w.regularClose).toBeLessThan(w.afterHoursClose);
  });
});

describe('splitSessions', () => {
  const bars = [
    bar('2026-08-21T08:00:00Z', 100), // 04:00 ET premercado
    bar('2026-08-21T13:29:00Z', 101), // 09:29 ET premercado (última)
    bar('2026-08-21T13:30:00Z', 102), // 09:30 ET regular (primera)
    bar('2026-08-21T19:59:00Z', 110), // 15:59 ET regular (última)
    bar('2026-08-21T20:00:00Z', 111), // 16:00 ET after-hours (primera)
    bar('2026-08-21T23:59:00Z', 112), // 19:59 ET after-hours (última)
  ];

  it('separa las tres ventanas sin solaparlas ni perder barras', () => {
    const s = splitSessions(bars, '2026-08-21');
    expect(s.premarket).toHaveLength(2);
    expect(s.regular).toHaveLength(2);
    expect(s.afterHours).toHaveLength(2);
    expect(s.premarket.length + s.regular.length + s.afterHours.length).toBe(bars.length);
  });

  it('la barra de las 09:30 ET pertenece a la sesión regular, no al premercado', () => {
    const s = splitSessions(bars, '2026-08-21');
    expect(s.premarket.at(-1)!.c).toBe(101);
    expect(s.regular[0].c).toBe(102);
  });

  it('la barra de las 16:00 ET pertenece a after-hours, no a la regular', () => {
    const s = splitSessions(bars, '2026-08-21');
    expect(s.regular.at(-1)!.c).toBe(110);
    expect(s.afterHours[0].c).toBe(111);
  });
});

describe('summarizeWindow', () => {
  it('devuelve null si no hay barras, en vez de un cero inventado', () => {
    expect(summarizeWindow([], 100)).toBeNull();
  });

  it('calcula variación porcentual contra el cierre de referencia', () => {
    const result = summarizeWindow([bar('2026-08-21T08:00:00Z', 110)], 100);
    expect(result.last).toBe(110);
    expect(result.changePercent).toBeCloseTo(10, 10);
  });

  it('deja la variación en null si no hay cierre de referencia válido', () => {
    expect(summarizeWindow([bar('2026-08-21T08:00:00Z', 110)], null).changePercent).toBeNull();
    expect(summarizeWindow([bar('2026-08-21T08:00:00Z', 110)], 0).changePercent).toBeNull();
  });

  it('acumula volumen y toma máximo y mínimo reales de la ventana', () => {
    const result = summarizeWindow([
      bar('2026-08-21T08:00:00Z', 100, { h: 105, l: 99, v: 500 }),
      bar('2026-08-21T08:01:00Z', 102, { h: 103, l: 95, v: 700 }),
    ], 100);
    expect(result.high).toBe(105);
    expect(result.low).toBe(95);
    expect(result.volume).toBe(1200);
    expect(result.bars).toBe(2);
  });
});

describe('createMassiveClient', () => {
  const okResponse = (results: unknown[]) => ({
    ok: true, status: 200, json: async () => ({ status: 'OK', results }),
  }) as unknown as Response;

  it('no se construye sin clave de API', () => {
    expect(() => createMassiveClient({})).toThrow(/clave de API/);
  });

  it('envía la clave como Bearer y nunca en la URL', async () => {
    let capturedUrl = '', capturedAuth = '';
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = String((init.headers as Record<string, string>).Authorization);
      return okResponse([]);
    }) as unknown as typeof fetch;
    const client = createMassiveClient({ apiKey: 'SECRETO123', fetchImpl, minIntervalMs: 0 });
    await client.minuteBars('AAPL', '2026-08-21', '2026-08-21');
    expect(capturedAuth).toBe('Bearer SECRETO123');
    // La clave no debe filtrarse en la query string, que suele quedar en logs.
    expect(capturedUrl).not.toContain('SECRETO123');
  });

  it('rechaza un ticker inválido sin gastar una llamada del plan', async () => {
    const fetchImpl = vi.fn();
    const client = createMassiveClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, minIntervalMs: 0 });
    const result = await client.minuteBars('EUR/USD', '2026-08-21', '2026-08-21');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('INVALID_TICKER');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('distingue el límite de llamadas (429) de un error genérico', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    const client = createMassiveClient({ apiKey: 'k', fetchImpl, minIntervalMs: 0 });
    const result = await client.minuteBars('AAPL', '2026-08-21', '2026-08-21');
    expect(result.reason).toBe('RATE_LIMITED');
  });

  it('espacia las llamadas para respetar el plan gratuito', async () => {
    const fetchImpl = (async () => okResponse([])) as unknown as typeof fetch;
    const waits: number[] = [];
    let clock = 0;
    const client = createMassiveClient({
      apiKey: 'k', fetchImpl, minIntervalMs: 12_500,
      now: () => clock, sleep: async (ms: number) => { waits.push(ms); clock += ms; },
    });
    await client.minuteBars('AAPL', '2026-08-21', '2026-08-21');
    await client.minuteBars('MSFT', '2026-08-21', '2026-08-21');
    expect(waits.at(-1)).toBe(12_500);
  });

  it('arma la instantánea de horario extendido con una sola llamada', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return okResponse([
        bar('2026-08-20T19:59:00Z', 200), // cierre regular del día previo
        bar('2026-08-20T20:30:00Z', 206), // after-hours del día previo
        bar('2026-08-21T08:00:00Z', 210), // premercado del día actual
        bar('2026-08-21T12:00:00Z', 212), // premercado del día actual (último)
      ]);
    }) as unknown as typeof fetch;
    const client = createMassiveClient({ apiKey: 'k', fetchImpl, minIntervalMs: 0 });
    const snapshot = await client.extendedHoursSnapshot('AAPL', '2026-08-20', '2026-08-21');

    expect(calls).toBe(1);
    expect(snapshot.previousClose).toBe(200);
    expect(snapshot.afterHours.last).toBe(206);
    expect(snapshot.afterHours.changePercent).toBeCloseTo(3, 10);
    expect(snapshot.premarket.last).toBe(212);
    expect(snapshot.premarket.changePercent).toBeCloseTo(6, 10);
    expect(snapshot.error).toBeNull();
  });

  it('un fallo de red devuelve el motivo, nunca datos vacíos silenciosos', async () => {
    const fetchImpl = (async () => { throw new Error('sin conexión'); }) as unknown as typeof fetch;
    const client = createMassiveClient({ apiKey: 'k', fetchImpl, minIntervalMs: 0 });
    const snapshot = await client.extendedHoursSnapshot('AAPL', '2026-08-20', '2026-08-21');
    expect(snapshot.error).toContain('sin conexión');
    expect(snapshot.premarket).toBeNull();
    expect(snapshot.afterHours).toBeNull();
  });
});

describe('lastTwoSessionDates — fin de semana y lunes', () => {
  // 13:00 UTC = 09:00 ET en verano, la hora a la que corre el informe.
  const at9amEt = (dateIso: string) => new Date(`${dateIso}T13:00:00Z`);

  it('un miércoles compara con el martes', () => {
    expect(lastTwoSessionDates(at9amEt('2026-08-19')))
      .toEqual({ currentSessionDate: '2026-08-19', previousSessionDate: '2026-08-18' });
  });

  it('un lunes compara con el viernes, no con el domingo', () => {
    expect(lastTwoSessionDates(at9amEt('2026-08-24')))
      .toEqual({ currentSessionDate: '2026-08-24', previousSessionDate: '2026-08-21' });
  });

  it('un sábado trata el viernes como sesión actual', () => {
    expect(lastTwoSessionDates(at9amEt('2026-08-22')))
      .toEqual({ currentSessionDate: '2026-08-21', previousSessionDate: '2026-08-20' });
  });

  it('un domingo también retrocede al viernes', () => {
    expect(lastTwoSessionDates(at9amEt('2026-08-23')))
      .toEqual({ currentSessionDate: '2026-08-21', previousSessionDate: '2026-08-20' });
  });

  it('nunca devuelve un sábado o domingo como fecha de sesión', () => {
    for (const day of ['2026-08-21','2026-08-22','2026-08-23','2026-08-24','2026-08-25']) {
      const { currentSessionDate, previousSessionDate } = lastTwoSessionDates(at9amEt(day));
      for (const session of [currentSessionDate, previousSessionDate]) {
        const weekday = new Date(`${session}T12:00:00Z`).getUTCDay();
        expect(weekday).toBeGreaterThan(0);
        expect(weekday).toBeLessThan(6);
      }
    }
  });
});

describe('selectAdaptiveUniverse', () => {
  const row = (T: string, o: number, c: number, v: number) => ({ T, o, c, v });

  it('excluye acciones de centavos aunque se muevan mucho', () => {
    const universe = selectAdaptiveUniverse([
      row('PENNY', 1, 2, 500_000_000),   // +100% pero a US$2
      row('REAL', 100, 105, 1_000_000),  // +5% a US$100
    ], { minPrice: 5, minDollarVolume: 1_000_000 });
    expect(universe.map((u: {ticker:string}) => u.ticker)).toEqual(['REAL']);
  });

  it('excluye lo que no tiene liquidez suficiente', () => {
    // Un +40% con US$20.000 negociados no es señal de mercado, es ruido con spread.
    const universe = selectAdaptiveUniverse([
      row('ILIQUIDO', 100, 140, 200),       // US$28.000 de volumen
      row('LIQUIDO', 100, 102, 1_000_000),  // US$102M
    ], { minDollarVolume: 50_000_000 });
    expect(universe.map((u: {ticker:string}) => u.ticker)).toEqual(['LIQUIDO']);
  });

  it('ordena por movimiento absoluto: una caída fuerte importa tanto como una subida', () => {
    const universe = selectAdaptiveUniverse([
      row('SUBE', 100, 103, 1_000_000),
      row('CAE', 100, 92, 1_000_000),
      row('PLANO', 100, 100.5, 1_000_000),
    ], { minDollarVolume: 1_000_000 });
    expect(universe.map((u: {ticker:string}) => u.ticker)).toEqual(['CAE', 'SUBE', 'PLANO']);
  });

  it('calcula la variación contra la apertura del día', () => {
    const universe = selectAdaptiveUniverse([row('AAA', 100, 110, 1_000_000)], { minDollarVolume: 1 });
    expect(universe[0].changePercent).toBeCloseTo(10, 10);
    expect(universe[0].dollarVolume).toBe(110_000_000);
  });

  it('respeta el límite y la lista de exclusión', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`T${i}`, 100, 100 + i, 1_000_000));
    expect(selectAdaptiveUniverse(rows, { minDollarVolume: 1, limit: 5 })).toHaveLength(5);
    const withoutTop = selectAdaptiveUniverse(rows, { minDollarVolume: 1, limit: 3, exclude: ['T29'] });
    expect(withoutTop.map((u: {ticker:string}) => u.ticker)).not.toContain('T29');
  });

  it('ignora filas corruptas sin romperse', () => {
    const universe = selectAdaptiveUniverse([
      null, {}, { T: 'X' }, row('OK', 100, 105, 1_000_000),
    ] as never[], { minDollarVolume: 1 });
    expect(universe.map((u: {ticker:string}) => u.ticker)).toEqual(['OK']);
  });
});

describe('normalizeNewsItem', () => {
  it('conserva editorial y enlace para que la noticia sea verificable', () => {
    const item = normalizeNewsItem({
      title: 'Apple sube tras resultados',
      publisher: { name: 'The Motley Fool' },
      article_url: 'https://example.com/a',
      published_utc: '2026-08-21T12:00:00Z',
      tickers: ['AAPL'],
      description: 'Resumen',
    });
    expect(item).toMatchObject({
      title: 'Apple sube tras resultados',
      publisher: 'The Motley Fool',
      url: 'https://example.com/a',
    });
  });

  it('descarta una entrada sin título en vez de propagar basura', () => {
    expect(normalizeNewsItem({})).toBeNull();
    expect(normalizeNewsItem(null)).toBeNull();
  });
});

describe('correcciones de calidad detectadas en el informe real', () => {
  it('el umbral de liquidez por defecto descarta microcaps volátiles', () => {
    // Calibrado contra el mercado real del 2026-08-21: con el umbral anterior el
    // ranking se llenaba de nombres como SDOT (+60%) con apenas US$260M negociados.
    const universe = selectAdaptiveUniverse([
      { T: 'MICRO', o: 8, c: 13, v: 20_000_000 },      // +62% pero US$260M
      { T: 'LIQUIDO', o: 100, c: 106, v: 20_000_000 }, // +6% con US$2.120M
    ]);
    expect(universe.map((u: {ticker:string}) => u.ticker)).toEqual(['LIQUIDO']);
  });

  it('calcula la variación de la sesión regular anterior sin llamadas extra', async () => {
    const okResponse = (results: unknown[]) => ({ ok: true, status: 200, json: async () => ({ status: 'OK', results }) }) as unknown as Response;
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return okResponse([
        bar('2026-08-20T13:30:00Z', 100, { o: 100 }), // apertura regular
        bar('2026-08-20T19:59:00Z', 105),             // cierre regular
      ]);
    }) as unknown as typeof fetch;
    const client = createMassiveClient({ apiKey: 'k', fetchImpl, minIntervalMs: 0 });
    const snapshot = await client.extendedHoursSnapshot('AAPL', '2026-08-20', '2026-08-21');
    expect(snapshot.previousRegularChangePercent).toBeCloseTo(5, 10);
    expect(calls).toBe(1);
  });

  it('deduplica feriados repetidos por bolsa', async () => {
    const fetchImpl = (async () => ({
      ok: true, status: 200, json: async () => ([
        { date: '2026-09-07', name: 'Labor Day', status: 'closed', exchange: 'NYSE' },
        { date: '2026-09-07', name: 'Labor Day', status: 'closed', exchange: 'NASDAQ' },
        { date: '2026-11-26', name: 'Thanksgiving', status: 'closed', exchange: 'NYSE' },
      ]),
    })) as unknown as typeof fetch;
    const client = createMassiveClient({ apiKey: 'k', fetchImpl, minIntervalMs: 0 });
    const result = await client.upcomingMarketHolidays();
    expect(result.data).toHaveLength(2);
    expect(result.data.map((h: {name:string}) => h.name)).toEqual(['Labor Day', 'Thanksgiving']);
  });
});
