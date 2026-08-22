import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { createDailyClockScheduler, msUntilNextDailyUtcTime } from '../shared/dailyClockScheduler.cjs';

describe('msUntilNextDailyUtcTime', () => {
  it('calcula el resto del día cuando la hora objetivo aún no llegó', () => {
    // 09:00 UTC -> faltan 4h para las 13:00 UTC (9:00 AST).
    const now = Date.UTC(2026, 7, 21, 9, 0, 0);
    expect(msUntilNextDailyUtcTime(now, 13, 0)).toBe(4 * 60 * 60 * 1000);
  });

  it('salta al día siguiente cuando la hora objetivo ya pasó hoy', () => {
    const now = Date.UTC(2026, 7, 21, 14, 0, 0); // 13:00 UTC ya pasó
    const expected = Date.UTC(2026, 7, 22, 13, 0, 0) - now;
    expect(msUntilNextDailyUtcTime(now, 13, 0)).toBe(expected);
  });

  it('salta al día siguiente en el instante exacto, no repite el mismo minuto', () => {
    const now = Date.UTC(2026, 7, 21, 13, 0, 0);
    const expected = Date.UTC(2026, 7, 22, 13, 0, 0) - now;
    expect(msUntilNextDailyUtcTime(now, 13, 0)).toBe(expected);
  });

  it('9:00 AST es siempre 13:00 UTC, sin variación estacional', () => {
    // A diferencia de marketSessionContext (que sí varía con el horario de verano de
    // EE. UU.), AST no observa DST: la constante es válida en cualquier época del año.
    const invierno = Date.UTC(2026, 0, 15, 9, 0, 0);
    const verano = Date.UTC(2026, 6, 15, 9, 0, 0);
    expect(msUntilNextDailyUtcTime(invierno, 13, 0)).toBe(4 * 60 * 60 * 1000);
    expect(msUntilNextDailyUtcTime(verano, 13, 0)).toBe(4 * 60 * 60 * 1000);
  });
});

describe('createDailyClockScheduler', () => {
  function harness() {
    let clock = Date.UTC(2026, 7, 21, 9, 0, 0);
    const timers: { id: number; delay: number; fn: () => void }[] = [];
    let nextId = 1;
    const setTimeoutFn = (fn: () => void, delay: number) => { const id = nextId++; timers.push({ id, delay, fn }); return id; };
    const clearTimeoutFn = (id: number) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
    const advance = (ms: number) => {
      clock += ms;
      const due = timers.filter(t => t.delay <= ms);
      for (const t of due) { clearTimeoutFn(t.id); t.fn(); }
    };
    return { now: () => clock, setTimeoutFn, clearTimeoutFn, advance, timers };
  }

  it('dispara la tarea al llegar la hora programada y vuelve a agendar', async () => {
    const h = harness();
    const runs: string[] = [];
    const scheduler = createDailyClockScheduler({
      task: async () => { runs.push('ran'); },
      utcHour: 13, utcMinute: 0,
      now: h.now, setTimeoutFn: h.setTimeoutFn, clearTimeoutFn: h.clearTimeoutFn,
    });
    scheduler.start();
    expect(runs).toEqual([]);
    h.advance(4 * 60 * 60 * 1000); // llega a las 13:00
    await vi.waitFor(() => expect(runs).toEqual(['ran']));
    expect(h.timers.length).toBe(1); // se reagendó para el día siguiente
  });

  it('no se solapa si la tarea anterior sigue corriendo', async () => {
    const h = harness();
    let concurrent = 0, maxConcurrent = 0;
    const scheduler = createDailyClockScheduler({
      task: async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await Promise.resolve(); concurrent--; },
      utcHour: 13, utcMinute: 0,
      now: h.now, setTimeoutFn: h.setTimeoutFn, clearTimeoutFn: h.clearTimeoutFn,
    });
    const first = scheduler.runOnce('MANUAL');
    const second = scheduler.runOnce('MANUAL');
    await Promise.all([first, second]);
    expect(maxConcurrent).toBe(1);
  });

  it('registra el error sin dejar de reagendar el día siguiente', async () => {
    const h = harness();
    const scheduler = createDailyClockScheduler({
      task: async () => { throw new Error('MT5 caído'); },
      utcHour: 13, utcMinute: 0,
      now: h.now, setTimeoutFn: h.setTimeoutFn, clearTimeoutFn: h.clearTimeoutFn,
    });
    scheduler.start();
    h.advance(4 * 60 * 60 * 1000);
    await vi.waitFor(() => expect(scheduler.state().lastError).toBe('MT5 caído'));
    expect(h.timers.length).toBe(1);
  });

  it('stop() cancela el temporizador pendiente', () => {
    const h = harness();
    const scheduler = createDailyClockScheduler({
      task: async () => {}, utcHour: 13, utcMinute: 0,
      now: h.now, setTimeoutFn: h.setTimeoutFn, clearTimeoutFn: h.clearTimeoutFn,
    });
    scheduler.start();
    expect(h.timers.length).toBe(1);
    scheduler.stop();
    expect(h.timers.length).toBe(0);
    expect(scheduler.state().nextRunAt).toBeNull();
  });
});
