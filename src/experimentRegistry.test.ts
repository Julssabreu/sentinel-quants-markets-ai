import { describe, expect, it } from 'vitest';
import { createExperimentRecord } from './experimentRegistry';

const dataset:any = { datasetId:'D-1', checksum:'abc', qualityStatus:'DATA_VALID' };
describe('Experiment Registry contract', () => {
  it('captures reproducibility inputs and component versions', () => {
    const record = createExperimentRecord({ experimentId:'Q-1', familyId:'SMC_V1', hypothesis:'Sweep adds edge.', datasets:[dataset], parameters:{ sweep:true }, timeframes:['D1','H4','H1','M15','M5'], instrumentId:'CRYPTO:BTC/USD', assetClass:'CRYPTO', dateRange:{ from:'2020-01-01', to:'2025-12-31' }, randomSeed:42, codeVersion:'0.3.19', commitHash:'deadbeef', runTimestamp:'2026-01-01T00:00:00Z', environmentVersion:'node-test' });
    expect(record).toMatchObject({ datasetChecksums:{ 'D-1':'abc' }, randomSeed:42, strategyVersion:expect.any(String), status:'CREATED' });
  });
  it('blocks invalid data and missing hypotheses', () => {
    expect(() => createExperimentRecord({ experimentId:'Q', familyId:'F', hypothesis:'', datasets:[dataset], parameters:{}, timeframes:[], instrumentId:'X', assetClass:'UNKNOWN', dateRange:{ from:'a', to:'b' }, randomSeed:1, codeVersion:'x', runTimestamp:'2026-01-01Z', environmentVersion:'x' })).toThrow(/hipótesis/);
    expect(() => createExperimentRecord({ experimentId:'Q', familyId:'F', hypothesis:'x', datasets:[{ ...dataset, qualityStatus:'DATA_INVALID' }], parameters:{}, timeframes:[], instrumentId:'X', assetClass:'UNKNOWN', dateRange:{ from:'a', to:'b' }, randomSeed:1, codeVersion:'x', runTimestamp:'2026-01-01Z', environmentVersion:'x' })).toThrow(/DATA_INVALID/);
  });
});
