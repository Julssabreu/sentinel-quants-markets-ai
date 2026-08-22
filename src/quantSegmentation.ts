import type { QuantSetupRecord } from './quantSetupRecord';
import { calculateQuantStatistics, type QuantStatistics } from './quantStatistics';

export type QuantSegmentDimension = 'assetClass' | 'symbol' | 'regime' | 'session' | 'direction' | 'volatilityBand';
export interface QuantSegment { dimension:QuantSegmentDimension; key:string; statistics:QuantStatistics; }

function volatilityBand(percentile: number) {
  if (percentile < 20) return 'P00_P19';
  if (percentile < 40) return 'P20_P39';
  if (percentile < 60) return 'P40_P59';
  if (percentile < 80) return 'P60_P79';
  return 'P80_P100';
}

export function completedQuantRecords(records: readonly QuantSetupRecord[]) {
  return records.filter(record => record.resultStatus === 'COMPLETED' && Number.isFinite(record.netResultR));
}

export function segmentQuantRecords(records: readonly QuantSetupRecord[]): QuantSegment[] {
  const completed = completedQuantRecords(records);
  const dimensions: Array<[QuantSegmentDimension, (record:QuantSetupRecord) => string]> = [
    ['assetClass', record => record.assetClass], ['symbol', record => record.symbol],
    ['regime', record => record.features.volatilityRegime], ['session', record => record.features.session],
    ['direction', record => record.direction], ['volatilityBand', record => volatilityBand(record.features.volatilityPercentile)],
  ];
  return dimensions.flatMap(([dimension, keyOf]) => {
    const groups = new Map<string, number[]>();
    completed.forEach(record => { const key = keyOf(record); groups.set(key, [...(groups.get(key) ?? []), record.netResultR!]); });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => ({ dimension, key, statistics:calculateQuantStatistics(values) }));
  });
}
