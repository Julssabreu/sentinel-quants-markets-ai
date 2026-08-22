import { atr, type Candle } from './analysisEngine';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

export type QuantMarketRegime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'TRANSITION' | 'UNKNOWN';
export interface MarketRegimeResult {
  regime: QuantMarketRegime;
  trendStrength: number;
  volatilityPercentile: number;
  atrPercentile: number;
  rangeExpansion: number;
  directionalPersistence: number;
  version: string;
}

const percentileRank = (values: number[], current: number) => values.length
  ? 100 * values.filter(value => value <= current).length / values.length
  : 0;

export function classifyQuantMarketRegime(candles: readonly Candle[]): MarketRegimeResult {
  if (candles.length < 80) return { regime:'UNKNOWN', trendStrength:0, volatilityPercentile:0, atrPercentile:0, rangeExpansion:0, directionalPersistence:0, version:SENTINEL_QUANT_VERSIONS.marketRegime };
  const sample = [...candles], closes = sample.map(c => c.close), currentAtr = atr(sample, 14);
  const atrHistory = sample.slice(30).map((_, index) => atr(sample.slice(0, index + 31), 14)).filter(Number.isFinite);
  const returns = closes.slice(1).map((close, index) => close / closes[index] - 1);
  const currentVol = Math.sqrt(returns.slice(-20).reduce((sum, value) => sum + value * value, 0) / 20);
  const historicalVol = returns.slice(20).map((_, index) => {
    const window = returns.slice(index, index + 20);
    return Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
  });
  const change = closes.at(-1)! - closes.at(-21)!;
  const path = sample.slice(-20).reduce((sum, bar) => sum + Math.abs(bar.close - bar.open), 0);
  const trendStrength = path > 0 ? Math.min(100, Math.abs(change) / path * 100) : 0;
  const signs = returns.slice(-20).map(Math.sign), majority = Math.max(signs.filter(x => x > 0).length, signs.filter(x => x < 0).length);
  const directionalPersistence = majority / signs.length * 100;
  const recentRange = sample.slice(-10).reduce((sum, bar) => sum + bar.high - bar.low, 0) / 10;
  const priorRange = sample.slice(-40, -10).reduce((sum, bar) => sum + bar.high - bar.low, 0) / 30;
  const rangeExpansion = priorRange > 0 ? recentRange / priorRange : 0;
  const atrPercentile = percentileRank(atrHistory, currentAtr), volatilityPercentile = percentileRank(historicalVol, currentVol);
  let regime: QuantMarketRegime = 'TRANSITION';
  if (volatilityPercentile >= 85 || atrPercentile >= 90) regime = 'HIGH_VOLATILITY';
  else if (volatilityPercentile <= 15 && atrPercentile <= 20) regime = 'LOW_VOLATILITY';
  else if (trendStrength >= 45 && directionalPersistence >= 60) regime = change > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
  else if (trendStrength <= 25 && rangeExpansion <= 1.15) regime = 'RANGING';
  return { regime, trendStrength, volatilityPercentile, atrPercentile, rangeExpansion, directionalPersistence, version:SENTINEL_QUANT_VERSIONS.marketRegime };
}
