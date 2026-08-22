import { atr, ema, rsi, zScore, type Candle } from "./analysisEngine";
import type { BacktestMetrics } from "./walkForward";
export type CompetingStrategy =
  | "BREAKOUT_STRUCTURE_ATR"
  | "TREND_MOMENTUM"
  | "MEAN_REVERSION"
  | "VOLATILITY_EXPANSION"
  | "SUPPLY_DEMAND_FIB_VOLUME";
export interface CompetitionRow {
  strategy: CompetingStrategy;
  name: string;
  folds: number;
  metrics: BacktestMetrics;
  eligible: boolean;
  reason: string;
}
type Signal = {
  side: 1 | -1;
  entry: number;
  stopAtr: number;
  reward: number;
} | null;
const rangeMean = (c: Candle[]) =>
  c.reduce((s, x) => s + x.high - x.low, 0) / Math.max(1, c.length);
function signalFor(
  strategy: CompetingStrategy,
  c: Candle[],
  i: number,
): Signal {
  const previous = c.slice(0, i),
    bar = c[i],
    closes = previous.map((x) => x.close),
    vol = atr(previous.slice(-80), 14);
  if (!Number.isFinite(vol) || vol <= 0) return null;
  const e20 = ema(closes.slice(-80), 20),
    e50 = ema(closes.slice(-80), 50),
    momentum = rsi(closes.slice(-80), 14),
    z = zScore(closes.slice(-20)),
    last20 = previous.slice(-20),
    high = Math.max(...last20.map((x) => x.high)),
    low = Math.min(...last20.map((x) => x.low));
  if (strategy === "BREAKOUT_STRUCTURE_ATR") {
    if (e20 > e50 && bar.high >= high)
      return { side: 1, entry: high, stopAtr: 1.5, reward: 2 };
    if (e20 < e50 && bar.low <= low)
      return { side: -1, entry: low, stopAtr: 1.5, reward: 2 };
  }
  if (strategy === "TREND_MOMENTUM") {
    if (
      e20 > e50 &&
      momentum >= 55 &&
      momentum <= 70 &&
      bar.close > previous.at(-1)!.high
    )
      return { side: 1, entry: bar.close, stopAtr: 1.4, reward: 2 };
    if (
      e20 < e50 &&
      momentum <= 45 &&
      momentum >= 30 &&
      bar.close < previous.at(-1)!.low
    )
      return { side: -1, entry: bar.close, stopAtr: 1.4, reward: 2 };
  }
  if (strategy === "MEAN_REVERSION") {
    if (z <= -2 && momentum < 35)
      return { side: 1, entry: bar.close, stopAtr: 1.2, reward: 1.5 };
    if (z >= 2 && momentum > 65)
      return { side: -1, entry: bar.close, stopAtr: 1.2, reward: 1.5 };
  }
  if (strategy === "VOLATILITY_EXPANSION") {
    const compressed =
      rangeMean(previous.slice(-10)) <
      rangeMean(previous.slice(-40, -10)) * 0.7;
    if (compressed && bar.high >= high)
      return { side: 1, entry: high, stopAtr: 1.3, reward: 2.2 };
    if (compressed && bar.low <= low)
      return { side: -1, entry: low, stopAtr: 1.3, reward: 2.2 };
  }
  if (strategy === "SUPPLY_DEMAND_FIB_VOLUME") {
    const structure=previous.slice(-60),swingHigh=Math.max(...structure.map(x=>x.high)),swingLow=Math.min(...structure.map(x=>x.low)),range=swingHigh-swingLow;
    if(range<=0)return null;
    const volumes=previous.slice(-30).map(x=>Number(x.realVolume||x.tickVolume||0)),averageVolume=volumes.reduce((sum,value)=>sum+value,0)/Math.max(1,volumes.length),barVolume=Number(bar.realVolume||bar.tickVolume||0),volumeConfirmed=averageVolume<=0||barVolume>=averageVolume*1.1;
    const demandTop=swingHigh-range*.5,demandBottom=swingHigh-range*.786,supplyBottom=swingLow+range*.5,supplyTop=swingLow+range*.786,bullishRejection=bar.close>bar.open&&bar.close>bar.low+(bar.high-bar.low)*.55,bearishRejection=bar.close<bar.open&&bar.close<bar.low+(bar.high-bar.low)*.45;
    if(e20>e50&&bar.low<=demandTop&&bar.low>=demandBottom&&bullishRejection&&volumeConfirmed)return{side:1,entry:bar.close,stopAtr:1.25,reward:2.4};
    if(e20<e50&&bar.high>=supplyBottom&&bar.high<=supplyTop&&bearishRejection&&volumeConfirmed)return{side:-1,entry:bar.close,stopAtr:1.25,reward:2.4};
  }
  return null;
}
function simulate(
  strategy: CompetingStrategy,
  c: Candle[],
  start: number,
  end: number,
): { metrics: BacktestMetrics; returns: number[] } {
  const returns: number[] = [];
  let ambiguous = 0,
    pos: null | {
      side: 1 | -1;
      entry: number;
      stop: number;
      target: number;
      reward: number;
    } = null;
  for (let i = Math.max(start, 80); i < end; i++) {
    const bar = c[i];
    if (pos) {
      const stop = pos.side === 1 ? bar.low <= pos.stop : bar.high >= pos.stop,
        target =
          pos.side === 1 ? bar.high >= pos.target : bar.low <= pos.target;
      if (stop && target) {
        ambiguous++;
        pos = null;
      } else if (stop) {
        returns.push(-1);
        pos = null;
      } else if (target) {
        returns.push(pos.reward);
        pos = null;
      }
      continue;
    }
    const s = signalFor(strategy, c, i);
    if (!s) continue;
    const vol = atr(c.slice(Math.max(0, i - 80), i), 14),
      risk = vol * s.stopAtr;
    pos = {
      ...s,
      stop: s.entry - s.side * risk,
      target: s.entry + s.side * risk * s.reward,
    };
  }
  let eq = 0,
    peak = 0,
    dd = 0;
  for (const value of returns) {
    eq += value;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const netR = returns.reduce((s, x) => s + x, 0);
  return {
    returns,
    metrics: {
      trades: returns.length,
      wins: returns.filter((x) => x > 0).length,
      losses: returns.filter((x) => x < 0).length,
      ambiguous,
      netR,
      averageR: returns.length ? netR / returns.length : 0,
      maxDrawdownR: dd,
    },
  };
}
export function compareStrategies(c: Candle[]): CompetitionRow[] {
  if (c.length < 500) return [];
  const strategies: CompetingStrategy[] = [
      "BREAKOUT_STRUCTURE_ATR",
      "TREND_MOMENTUM",
      "MEAN_REVERSION",
      "VOLATILITY_EXPANSION",
      "SUPPLY_DEMAND_FIB_VOLUME",
    ],
    names: Record<CompetingStrategy, string> = {
      BREAKOUT_STRUCTURE_ATR: "Ruptura estructural + ATR",
      TREND_MOMENTUM: "Tendencia y momentum",
      MEAN_REVERSION: "Reversión a la media",
      VOLATILITY_EXPANSION: "Expansión de volatilidad",
      SUPPLY_DEMAND_FIB_VOLUME: "Supply & Demand + Fibonacci + volumen",
    };
  const train = Math.floor(c.length * 0.45),
    test = Math.floor(c.length * 0.15),
    purge = 10;
  return strategies
    .map((strategy) => {
      const returns: number[] = [];
      let ambiguous = 0,
        folds = 0;
      for (let end = train; end + purge + test <= c.length; end += test) {
        const result = simulate(strategy, c, end + purge, end + purge + test);
        returns.push(...result.returns);
        ambiguous += result.metrics.ambiguous;
        folds++;
      }
      let eq = 0,
        peak = 0,
        dd = 0;
      for (const value of returns) {
        eq += value;
        peak = Math.max(peak, eq);
        dd = Math.max(dd, peak - eq);
      }
      const netR = returns.reduce((s, x) => s + x, 0),
        metrics = {
          trades: returns.length,
          wins: returns.filter((x) => x > 0).length,
          losses: returns.filter((x) => x < 0).length,
          ambiguous,
          netR,
          averageR: returns.length ? netR / returns.length : 0,
          maxDrawdownR: dd,
        },
        eligible = metrics.trades >= 30 && metrics.averageR > 0 && dd <= 10;
      return {
        strategy,
        name: names[strategy],
        folds,
        metrics,
        eligible,
        reason:
          metrics.trades < 30
            ? "Muestra insuficiente"
            : metrics.averageR <= 0
              ? "Expectativa no positiva"
              : dd > 10
                ? "Drawdown excesivo"
                : "Candidato elegible para revisión",
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.metrics.averageR - a.metrics.averageR,
    );
}
