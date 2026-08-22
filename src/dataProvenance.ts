import type { Candle } from './analysisEngine';
import type { DataQualityStatus } from './dataQualityEngine';
import type { MarketClass } from './marketArchitecture';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

export interface DatasetProvenance {
  schemaVersion: 1;
  datasetId: string;
  provider: string;
  instrumentId: string;
  symbol: string;
  assetClass: MarketClass;
  broker: string | null;
  exchange: string | null;
  timezone: string;
  dateFrom: string | null;
  dateTo: string | null;
  resolution: string;
  rows: number;
  downloadTimestamp: string;
  processingTimestamp: string;
  checksum: string;
  checksumAlgorithm: 'FNV1A32_CANONICAL_V1';
  normalizationVersion: string;
  qualityStatus: DataQualityStatus;
  qualityReportId: string | null;
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `FNV1A-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function canonicalCandleChecksum(candles: readonly Candle[]): string {
  return fnv1a(candles.map(bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.tickVolume ?? '', bar.spread ?? '', bar.realVolume ?? ''].join('|')).join('\n'));
}

export function createDatasetProvenance(input: Omit<DatasetProvenance, 'schemaVersion' | 'rows' | 'dateFrom' | 'dateTo' | 'checksum' | 'checksumAlgorithm' | 'normalizationVersion' | 'qualityReportId'> & { candles: readonly Candle[]; qualityReportId?: string | null }): DatasetProvenance {
  const { candles, ...metadata } = input;
  const timestamps = candles.map(bar => Date.parse(bar.time)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    schemaVersion:1, ...metadata, rows:candles.length,
    dateFrom:timestamps.length ? new Date(timestamps[0]).toISOString() : null,
    dateTo:timestamps.length ? new Date(timestamps.at(-1)!).toISOString() : null,
    checksum:canonicalCandleChecksum(candles), checksumAlgorithm:'FNV1A32_CANONICAL_V1',
    normalizationVersion:SENTINEL_QUANT_VERSIONS.normalization,
    qualityReportId:input.qualityReportId ?? null,
  };
}
