import { describe, expect, it, vi } from 'vitest';
import {
  createMassiveClient, newYorkTimeToUtcMs, sessionWindowsForDate, splitSessions, summarizeWindow,
  lastTwoSessionDates,
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
