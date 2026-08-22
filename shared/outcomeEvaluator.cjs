const TERMINAL_STATUSES = new Set([
  'TP2',
  'STOP',
  'AMBIGUOUS',
  'EXPIRED',
  'INVALIDATED',
]);
const { compatibleSimulation, validatePlanContract } = require('./backendGuard.cjs');

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function validTime(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : null;
}

function normalizedPrevious(previousOutcome) {
  const previous = previousOutcome && typeof previousOutcome === 'object' ? previousOutcome : {};
  return {
    status: typeof previous.status === 'string' ? previous.status : null,
    activatedAt: validTime(previous.activatedAt) === null ? null : previous.activatedAt,
    activationPrice: finite(previous.activationPrice) ? Number(previous.activationPrice) : null,
    lastEvaluatedAt: validTime(previous.lastEvaluatedAt) === null ? null : previous.lastEvaluatedAt,
    barsObserved: Math.max(0, Math.trunc(Number(previous.barsObserved) || 0)),
    mfe: Math.max(0, Number(previous.mfe) || 0),
    mae: Math.max(0, Number(previous.mae) || 0),
    tp1Reached: previous.tp1Reached === true,
  };
}

function snapshot(status, state, checkedAt, extra = {}) {
  return {
    status,
    checkedAt,
    activatedAt: state.activatedAt,
    activationPrice: state.activationPrice,
    lastEvaluatedAt: state.lastEvaluatedAt,
    barsObserved: state.barsObserved,
    mfe: state.mfe,
    mae: state.mae,
    tp1Reached: state.tp1Reached,
    ...extra,
  };
}

function evaluatePlan(plan, candles, simulationAnchorTime, previousOutcome = null) {
  const checkedAt = new Date().toISOString();
  const anchorMs = validTime(simulationAnchorTime);
  const direction = String(plan?.direction || '').toUpperCase();
  if (
    !plan
    || !['BUY', 'SELL'].includes(direction)
    || !finite(plan.trigger)
    || !finite(plan.stop)
    || anchorMs === null
  ) {
    return { status: 'NO_PLAN', checkedAt };
  }

  if (TERMINAL_STATUSES.has(previousOutcome?.status)) {
    return { ...previousOutcome, checkedAt };
  }

  const buy = direction === 'BUY';
  const trigger = Number(plan.trigger);
  const stop = Number(plan.stop);
  const tp1 = finite(plan.tp1) ? Number(plan.tp1) : null;
  const tp2 = finite(plan.tp2) ? Number(plan.tp2) : null;
  const maxEntry = finite(plan.maxEntry) ? Number(plan.maxEntry) : null;
  const expiresAfterBars = finite(plan.expiresAfterBars) && Number(plan.expiresAfterBars) > 0
    ? Math.trunc(Number(plan.expiresAfterBars))
    : null;
  const state = normalizedPrevious(previousOutcome);
  const previousCursorMs = validTime(state.lastEvaluatedAt);
  const cursorMs = Math.max(anchorMs, previousCursorMs ?? anchorMs);

  // MT5 range queries are inclusive. Both filters are deliberately strict:
  // the signal candle can never activate its own plan, and a previously
  // evaluated candle can never be counted twice during incremental updates.
  const byTime = new Map();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const candleMs = validTime(candle?.time);
    if (candleMs === null || candleMs <= anchorMs || candleMs <= cursorMs) continue;
    byTime.set(candleMs, candle);
  }
  const relevant = [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, candle]) => candle);

  for (const candle of relevant) {
    const candleTime = new Date(validTime(candle.time)).toISOString();
    const open = finite(candle.open) ? Number(candle.open) : null;
    const high = finite(candle.high) ? Number(candle.high) : null;
    const low = finite(candle.low) ? Number(candle.low) : null;
    if (high === null || low === null) continue;

    const wasActiveBeforeCandle = Boolean(state.activatedAt);
    let activatedThisCandle = false;
    let activationKnownAtOpen = false;
    state.lastEvaluatedAt = candleTime;
    state.barsObserved += 1;

    if (!state.activatedAt) {
      const openedBeyondMaxEntry = maxEntry !== null && open !== null
        && (buy ? open > maxEntry : open < maxEntry);
      if (openedBeyondMaxEntry) {
        return snapshot('INVALIDATED', state, checkedAt, {
          resolvedAt: candleTime,
          resolution: 'GAP_BEYOND_MAX_ENTRY',
          fillPrice: open,
          notes: 'La vela abrió más allá de la entrada máxima; la simulación no persigue el precio.',
        });
      }

      const triggeredAtOpen = open !== null && (buy ? open >= trigger : open <= trigger);
      const triggeredByRange = buy ? high >= trigger : low <= trigger;
      const triggered = triggeredAtOpen || triggeredByRange;
      // If the trigger was not reached, a wick through the invalidation level
      // is enough to cancel the thesis even when the candle later recovers.
      const invalidatedBeforeTrigger = buy ? low <= stop : high >= stop;
      if (invalidatedBeforeTrigger && !triggered) {
        return snapshot('INVALIDATED', state, checkedAt, {
          resolvedAt: candleTime,
          notes: 'La vela cerró más allá de la invalidación antes de activar la entrada.',
        });
      }
      if (!triggered) {
        if (expiresAfterBars !== null && state.barsObserved >= expiresAfterBars) {
          return snapshot('EXPIRED', state, checkedAt, {
            resolvedAt: candleTime,
            notes: `No se activó dentro de ${expiresAfterBars} velas posteriores a la señal.`,
          });
        }
        continue;
      }

      state.activatedAt = candleTime;
      state.activationPrice = triggeredAtOpen ? open : trigger;
      activatedThisCandle = true;
      activationKnownAtOpen = triggeredAtOpen;
    }

    // Once active before this candle, its opening price is chronologically
    // known. A gap through stop/TP therefore has a deterministic outcome even
    // if the same OHLC candle later traverses the opposite level.
    if (wasActiveBeforeCandle && open !== null) {
      const gapStop = buy ? open <= stop : open >= stop;
      const gapTp2 = tp2 !== null && (buy ? open >= tp2 : open <= tp2);
      const gapTp1 = tp1 !== null && (buy ? open >= tp1 : open <= tp1);
      const entryPrice = state.activationPrice ?? trigger;
      const openFavorable = buy ? open - entryPrice : entryPrice - open;
      const openAdverse = buy ? entryPrice - open : open - entryPrice;
      state.mfe = Math.max(state.mfe, openFavorable);
      state.mae = Math.max(state.mae, openAdverse);
      if (gapStop) {
        return snapshot('STOP', state, checkedAt, {
          resolvedAt: candleTime,
          resolution: 'GAP_AT_OPEN',
          fillPrice: open,
        });
      }
      if (gapTp2) {
        return snapshot('TP2', { ...state, tp1Reached: true }, checkedAt, {
          resolvedAt: candleTime,
          resolution: 'GAP_AT_OPEN',
          fillPrice: open,
        });
      }
      if (gapTp1) state.tp1Reached = true;
    }

    const entryPrice = state.activationPrice ?? trigger;
    const favorable = buy ? high - entryPrice : entryPrice - low;
    const adverse = buy ? entryPrice - low : high - entryPrice;
    state.mfe = Math.max(state.mfe, favorable);
    // With an intrabar trigger, the adverse extreme may have occurred before
    // the fill. Do not attribute it to the simulated position without order data.
    if (!activatedThisCandle || activationKnownAtOpen) state.mae = Math.max(state.mae, adverse);
    const hitStop = buy ? low <= stop : high >= stop;
    const hitTp2 = tp2 !== null && (buy ? high >= tp2 : low <= tp2);
    const hitTp1 = tp1 !== null && (buy ? high >= tp1 : low <= tp1);
    const newlyHitTarget = hitTp2 || (!state.tp1Reached && hitTp1);

    if (activatedThisCandle && !activationKnownAtOpen && hitStop) {
      return snapshot('AMBIGUOUS', state, checkedAt, {
        resolvedAt: candleTime,
        notes: 'Activación y stop aparecen en la misma vela; se desconoce el orden intravela.',
      });
    }
    if (hitStop && newlyHitTarget) {
      return snapshot('AMBIGUOUS', state, checkedAt, {
        resolvedAt: candleTime,
        notes: 'Stop y objetivo nuevo aparecen dentro de la misma vela; se desconoce el orden intravela.',
      });
    }
    if (hitStop) {
      return snapshot('STOP', state, checkedAt, { resolvedAt: candleTime });
    }
    if (hitTp2) {
      return snapshot('TP2', { ...state, tp1Reached: true }, checkedAt, { resolvedAt: candleTime });
    }
    if (hitTp1) state.tp1Reached = true;
  }

  const status = state.activatedAt
    ? (state.tp1Reached ? 'OPEN_TP1_REACHED' : 'OPEN')
    : 'NOT_TRIGGERED';
  return snapshot(status, state, checkedAt);
}

function selectFairEvaluationBatch(records, limit = 12) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 12)));
  const timestamp = value => validTime(value) ?? 0;
  const eligible = (Array.isArray(records) ? records : [])
    .filter(record => {
      if (!compatibleSimulation(record) || TERMINAL_STATUSES.has(record?.outcome?.status)) return false;
      try { validatePlanContract(record); return true; } catch { return false; }
    })
    .sort((left, right) => timestamp(left.lastEvaluationAttemptAt) - timestamp(right.lastEvaluationAttemptAt)
      || timestamp(left.createdAt) - timestamp(right.createdAt));
  return { candidates: eligible, batch: eligible.slice(0, safeLimit), limit: safeLimit };
}

module.exports = { evaluatePlan, selectFairEvaluationBatch };
