'use strict';
/**
 * Programador de tarea diaria a una hora UTC fija.
 *
 * República Dominicana usa AST (UTC-4) sin horario de verano, así que "9:00 AST"
 * es siempre "13:00 UTC" — a diferencia de marketSessionContext.ts, que asume horario
 * de verano de EE. UU. todo el año y por eso se desvía una hora en invierno (ver
 * docs/AUDITORIA_02_ESTADO_ACTUAL.md). Aquí no hay ese riesgo porque el objetivo real
 * es un instante UTC fijo, no una hora local con reglas de DST.
 */

/** Milisegundos hasta la próxima ocurrencia de `utcHour:utcMinute` en UTC. */
function msUntilNextDailyUtcTime(nowMs, utcHour, utcMinute = 0) {
  const now = new Date(nowMs);
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute, 0, 0));
  if (target.getTime() <= nowMs) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - nowMs;
}

/**
 * Dispara `task` una vez por día a `utcHour:utcMinute` UTC. A diferencia de
 * `createOperationalHealthScheduler` (intervalo fijo desde el arranque), este se
 * realinea cada disparo contra el reloj real, así que no acumula desfase.
 */
function createDailyClockScheduler(options) {
  const task = options.task, utcHour = options.utcHour, utcMinute = options.utcMinute ?? 0,
    now = options.now || (() => Date.now()),
    setTimeoutFn = options.setTimeoutFn || setTimeout,
    clearTimeoutFn = options.clearTimeoutFn || clearTimeout,
    onState = options.onState || (() => {});
  let timer = null, stopped = true, running = null, lastRunAt = null, lastError = null, nextRunAt = null;

  function state() {
    return { stopped, running: Boolean(running), lastRunAt, lastError, nextRunAt, utcHour, utcMinute };
  }
  function persist() { void Promise.resolve(onState(state())).catch(() => {}); }

  async function runOnce(reason = 'SCHEDULED') {
    if (running) return running;
    running = Promise.resolve()
      .then(() => task({ reason, firedAt: new Date(now()).toISOString() }))
      .then(value => { lastRunAt = now(); lastError = null; return value; })
      .catch(error => { lastRunAt = now(); lastError = error instanceof Error ? error.message : String(error); throw error; })
      .finally(() => { running = null; persist(); });
    persist();
    try { return await running; } catch { return null; }
  }

  function scheduleNext() {
    if (stopped) return;
    const delay = msUntilNextDailyUtcTime(now(), utcHour, utcMinute);
    nextRunAt = now() + delay;
    timer = setTimeoutFn(() => { void runOnce('SCHEDULED').finally(scheduleNext); }, delay);
    timer?.unref?.();
    persist();
  }

  function start() { if (!stopped) return; stopped = false; scheduleNext(); }
  function stop() { stopped = true; if (timer) clearTimeoutFn(timer); timer = null; nextRunAt = null; persist(); }

  return { start, stop, runOnce, state };
}

module.exports = { msUntilNextDailyUtcTime, createDailyClockScheduler };
