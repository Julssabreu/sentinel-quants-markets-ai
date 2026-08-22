import { atr, type Candle } from './analysisEngine';
import type { MarketClass } from './marketArchitecture';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

export interface InstrumentNormalizationMetadata {
  instrumentId: string;
  canonicalSymbol: string;
  assetClass: MarketClass;
  provider: string;
  broker: string | null;
  exchange: string | null;
  timezone: string;
  tickSize: number | null;
  pointSize: number | null;
  contractSize: number | null;
}

export interface NormalizedMarketSnapshot {
  instrument: InstrumentNormalizationMetadata;
  timestamp: string;
  price: number;
  atr: number;
  atrPercent: number;
  rangeATR: number;
  bodyATR: number;
  returnPercent: number;
  spreadPrice: number | null;
  spreadATR: number | null;
  spreadBps: number | null;
  tickSizeATR: number | null;
  tickVolume: number | null;
  realVolume: number | null;
  normalizationVersion: string;
}

export function normalizeMarketSnapshot(
  candles: readonly Candle[],
  instrument: InstrumentNormalizationMetadata,
  quote?: { bid?: number | null; ask?: number | null },
): NormalizedMarketSnapshot | null {
  if (candles.length < 15) return null;
  const current = candles.at(-1)!, previous = candles.at(-2)!;
  const volatility = atr([...candles], 14), price = current.close;
  if (![volatility, price].every(Number.isFinite) || volatility <= 0 || price <= 0) return null;
  const bid = quote?.bid, ask = quote?.ask;
  const spreadPrice = Number.isFinite(bid) && Number.isFinite(ask) && ask! >= bid! ? ask! - bid! : null;
  return {
    instrument, timestamp:current.time, price, atr:volatility,
    atrPercent:volatility / price * 100,
    rangeATR:(current.high - current.low) / volatility,
    bodyATR:Math.abs(current.close - current.open) / volatility,
    returnPercent:previous.close > 0 ? (current.close / previous.close - 1) * 100 : 0,
    spreadPrice,
    spreadATR:spreadPrice == null ? null : spreadPrice / volatility,
    spreadBps:spreadPrice == null ? null : spreadPrice / price * 10_000,
    tickSizeATR:instrument.tickSize && instrument.tickSize > 0 ? instrument.tickSize / volatility : null,
    tickVolume:Number.isFinite(current.tickVolume) ? current.tickVolume! : null,
    realVolume:Number.isFinite(current.realVolume) ? current.realVolume! : null,
    normalizationVersion:SENTINEL_QUANT_VERSIONS.normalization,
  };
}
