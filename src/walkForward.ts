import { atr, ema, type Candle } from "./analysisEngine";
export interface StrategyParams {
  lookback: number;
  atrMultiple: number;
  rewardRisk: number;
}
export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  ambiguous: number;
  netR: number;
  averageR: number;
  maxDrawdownR: number;
}
export interface WalkForwardFold {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  params: StrategyParams;
  train: BacktestMetrics;
  test: BacktestMetrics;
}
export interface WalkForwardResult {
  folds: WalkForwardFold[];
  combined: BacktestMetrics;
  outOfSampleTrades: number;
  outOfSampleReturns: number[];
  warning: string | null;
}
const empty = (): BacktestMetrics => ({
  trades: 0,
  wins: 0,
  losses: 0,
  ambiguous: 0,
  netR: 0,
  averageR: 0,
  maxDrawdownR: 0,
});
export function backtestBreakout(
  c: Candle[],
  p: StrategyParams,
  start = 60,
  end = c.length,
): BacktestMetrics {
  const returns: number[] = [];
  let ambiguous = 0,
    pos: null | { side: 1 | -1; entry: number; stop: number; target: number } =
      null;
  for (let i = Math.max(start, 60); i < Math.min(end, c.length); i++) {
    const bar = c[i];
    if (pos) {
      const stop = pos.side === 1 ? bar.low <= pos.stop : bar.high >= pos.stop,
        target =
          pos.side === 1 ? bar.high >= pos.target : bar.low <= pos.target;
      if (stop && target) {
        ambiguous++;
        pos = null;
        continue;
      }
      if (stop) {
        returns.push(-1);
        pos = null;
        continue;
      }
      if (target) {
        returns.push(p.rewardRisk);
        pos = null;
        continue;
      }
      continue;
    }
    const closes = c.slice(0, i).map((x) => x.close),
      e20 = ema(closes.slice(-80), 20),
      e50 = ema(closes.slice(-80), 50),
      vol = atr(c.slice(Math.max(0, i - 80), i), 14);
    if (![e20, e50, vol].every(Number.isFinite) || vol <= 0) continue;
    const previous = c.slice(i - p.lookback, i),
      high = Math.max(...previous.map((x) => x.high)),
      low = Math.min(...previous.map((x) => x.low));
    let side: 1 | -1 | 0 = 0,
      entry = 0;
    if (e20 > e50 && bar.high >= high) {
      side = 1;
      entry = high;
    } else if (e20 < e50 && bar.low <= low) {
      side = -1;
      entry = low;
    }
    if (!side) continue;
    const risk = vol * p.atrMultiple;
    pos = {
      side,
      entry,
      stop: entry - side * risk,
      target: entry + side * risk * p.rewardRisk,
    };
    const hitStop = side === 1 ? bar.low <= pos.stop : bar.high >= pos.stop,
      hitTarget = side === 1 ? bar.high >= pos.target : bar.low <= pos.target;
    if (hitStop && hitTarget) {
      ambiguous++;
      pos = null;
    } else if (hitStop) {
      returns.push(-1);
      pos = null;
    } else if (hitTarget) {
      returns.push(p.rewardRisk);
      pos = null;
    }
  }
  let equity = 0,
    peak = 0,
    maxDrawdownR = 0;
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  const netR = returns.reduce((s, x) => s + x, 0);
  return {
    trades: returns.length,
    wins: returns.filter((x) => x > 0).length,
    losses: returns.filter((x) => x < 0).length,
    ambiguous,
    netR,
    averageR: returns.length ? netR / returns.length : 0,
    maxDrawdownR,
  };
}
export function runWalkForward(c: Candle[]): WalkForwardResult {
  if (c.length < 500)
    return {
      folds: [],
      combined: empty(),
      outOfSampleTrades: 0,
      outOfSampleReturns: [],
      warning: "Se requieren al menos 500 velas para walk-forward.",
    };
  const candidates: StrategyParams[] = [];
  for (const lookback of [10, 20, 30])
    for (const atrMultiple of [1, 1.5, 2])
      candidates.push({ lookback, atrMultiple, rewardRisk: 2 });
  const trainSize = Math.floor(c.length * 0.45),
    testSize = Math.floor(c.length * 0.15),
    purge = 10,
    folds: WalkForwardFold[] = [];
  let trainStart = 0,
    trainEnd = trainSize;
  while (trainEnd + purge + testSize <= c.length) {
    const testStart = trainEnd + purge,
      testEnd = testStart + testSize,
      ranked = candidates
        .map((params) => ({
          params,
          metrics: backtestBreakout(
            c,
            params,
            Math.max(60, trainStart),
            trainEnd,
          ),
        }))
        .sort(
          (a, b) =>
            b.metrics.averageR - a.metrics.averageR ||
            b.metrics.trades - a.metrics.trades,
        ),
      best = ranked[0];
    folds.push({
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      params: best.params,
      train: best.metrics,
      test: backtestBreakout(c, best.params, testStart, testEnd),
    });
    trainStart += testSize;
    trainEnd += testSize;
  }
  const tests = folds.flatMap((f) =>
      Array(f.test.wins).fill(2).concat(Array(f.test.losses).fill(-1)),
    ),
    combined = empty();
  combined.trades = tests.length;
  combined.wins = tests.filter((x) => x > 0).length;
  combined.losses = tests.filter((x) => x < 0).length;
  combined.ambiguous = folds.reduce((s, f) => s + f.test.ambiguous, 0);
  combined.netR = tests.reduce((s, x) => s + x, 0);
  combined.averageR = tests.length ? combined.netR / tests.length : 0;
  let eq = 0,
    peak = 0;
  for (const r of tests) {
    eq += r;
    peak = Math.max(peak, eq);
    combined.maxDrawdownR = Math.max(combined.maxDrawdownR, peak - eq);
  }
  return {
    folds,
    combined,
    outOfSampleTrades: tests.length,
    outOfSampleReturns: tests,
    warning:
      tests.length < 30
        ? "Muestra fuera de muestra inferior a 30 operaciones."
        : null,
  };
}
