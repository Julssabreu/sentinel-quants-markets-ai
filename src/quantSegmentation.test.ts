import { describe, expect, it } from 'vitest';
import { segmentQuantRecords } from './quantSegmentation';

describe('Quant segmentation', () => {
  it('segments completed net results and excludes non-executed candidates', () => {
    const base:any = { resultStatus:'COMPLETED', netResultR:1, assetClass:'CRYPTO', symbol:'BTC/USD', direction:'LONG', features:{ volatilityRegime:'TRENDING_UP', session:'CRYPTO_24_7', volatilityPercentile:65 } };
    const segments = segmentQuantRecords([base, { ...base, netResultR:-.5 }, { ...base, resultStatus:'NOT_EXECUTED', netResultR:null }]);
    expect(segments.find(segment => segment.dimension === 'assetClass' && segment.key === 'CRYPTO')?.statistics).toMatchObject({ sampleSize:2, expectancyR:.25 });
    expect(segments.find(segment => segment.dimension === 'volatilityBand')?.key).toBe('P60_P79');
  });
});
