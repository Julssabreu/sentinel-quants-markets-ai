export interface ConfidenceInterval {
  level: .95;
  lower: number | null;
  upper: number | null;
}

export interface QuantStatistics {
  sampleSize: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  expectancyR: number | null;
  expectancy95CI: ConfidenceInterval;
  profitFactor: number | null;
  payoffRatio: number | null;
  sharpePerTrade: number | null;
  sortinoPerTrade: number | null;
  maxDrawdownR: number;
  maxDrawdownDurationTrades: number;
  recoveryDurationTrades: number | null;
  maxConsecutiveLosses: number;
  medianTradeR: number | null;
  standardDeviationR: number | null;
  downsideDeviationR: number | null;
  minimumR: number | null;
  maximumR: number | null;
  top5PercentProfitContribution: number | null;
  top10TradeContribution: number | null;
  returns: number[];
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values: readonly number[], average = mean(values)) => {
  if (values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
};
const median = (values: readonly number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function calculateQuantStatistics(rawReturns: readonly number[]): QuantStatistics {
  const returns = rawReturns.filter(Number.isFinite);
  const sampleSize = returns.length, wins = returns.filter(value => value > 0), losses = returns.filter(value => value < 0);
  const expectancyR = sampleSize ? mean(returns) : null;
  const deviation = sampleSize ? standardDeviation(returns, expectancyR!) : null;
  const standardError = deviation == null ? null : deviation / Math.sqrt(sampleSize);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const averageWinR = wins.length ? mean(wins) : null, averageLossR = losses.length ? mean(losses) : null;
  const downside = returns.map(value => Math.min(0, value));
  const downsideDeviationR = sampleSize ? Math.sqrt(downside.reduce((sum, value) => sum + value * value, 0) / sampleSize) : null;
  let equity = 0, peak = 0, peakIndex = 0, maxDrawdownR = 0, maxDrawdownDurationTrades = 0;
  let worstPeakIndex = 0, worstTroughIndex = 0, recoveryDurationTrades: number | null = null, consecutive = 0, maxConsecutiveLosses = 0;
  returns.forEach((value, index) => {
    equity += value;
    if (equity > peak) { peak = equity; peakIndex = index + 1; }
    const drawdown = peak - equity, duration = index + 1 - peakIndex;
    if (drawdown > maxDrawdownR) { maxDrawdownR = drawdown; worstPeakIndex = peakIndex; worstTroughIndex = index + 1; recoveryDurationTrades = null; }
    maxDrawdownDurationTrades = Math.max(maxDrawdownDurationTrades, duration);
    if (maxDrawdownR > 0 && recoveryDurationTrades == null && index + 1 > worstTroughIndex && equity >= peak)
      recoveryDurationTrades = index + 1 - worstPeakIndex;
    consecutive = value < 0 ? consecutive + 1 : 0;
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutive);
  });
  const positiveSorted = [...wins].sort((a, b) => b - a);
  const netProfit = returns.reduce((sum, value) => sum + value, 0);
  const contribution = (values: readonly number[]) => netProfit > 0 ? values.reduce((sum, value) => sum + value, 0) / netProfit * 100 : null;
  const top5Count = wins.length ? Math.max(1, Math.ceil(sampleSize * .05)) : 0;
  return {
    sampleSize, wins:wins.length, losses:losses.length, breakeven:sampleSize - wins.length - losses.length,
    winRate:sampleSize ? wins.length / sampleSize : null, averageWinR, averageLossR, expectancyR,
    expectancy95CI:{ level:.95, lower:standardError == null || expectancyR == null ? null : expectancyR - 1.96 * standardError, upper:standardError == null || expectancyR == null ? null : expectancyR + 1.96 * standardError },
    profitFactor:grossLoss > 0 ? grossProfit / grossLoss : null,
    payoffRatio:averageWinR != null && averageLossR != null && averageLossR < 0 ? averageWinR / Math.abs(averageLossR) : null,
    sharpePerTrade:deviation && expectancyR != null ? expectancyR / deviation * Math.sqrt(sampleSize) : null,
    sortinoPerTrade:downsideDeviationR && expectancyR != null ? expectancyR / downsideDeviationR * Math.sqrt(sampleSize) : null,
    maxDrawdownR, maxDrawdownDurationTrades, recoveryDurationTrades, maxConsecutiveLosses,
    medianTradeR:median(returns), standardDeviationR:deviation, downsideDeviationR,
    minimumR:sampleSize ? Math.min(...returns) : null, maximumR:sampleSize ? Math.max(...returns) : null,
    top5PercentProfitContribution:top5Count ? contribution(positiveSorted.slice(0, top5Count)) : null,
    top10TradeContribution:positiveSorted.length ? contribution(positiveSorted.slice(0, 10)) : null,
    returns:[...returns],
  };
}
