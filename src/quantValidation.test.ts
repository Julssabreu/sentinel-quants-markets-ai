import { describe, expect, it } from 'vitest';
import { runRollingWalkForward, splitChronologically } from './quantValidation';

describe('Quant chronological validation', () => {
  it('creates purged train, validation and locked OOS partitions', () => {
    const records:any[] = Array.from({ length:20 }, (_, index) => ({ resultStatus:'COMPLETED', netResultR:index % 2 ? 1 : -1, sourceTimestamp:new Date(1700000000000 + index * 1000).toISOString() }));
    const split = splitChronologically(records, { training:.5, validation:.25 }, 1);
    expect(split.training).toHaveLength(9);
    expect(split.validation).toHaveLength(3);
    expect(split.outOfSample).toHaveLength(4);
    expect(Date.parse(split.training.at(-1)!.sourceTimestamp)).toBeLessThan(Date.parse(split.validation[0].sourceTimestamp));
  });
  it('runs repeated forward tests with a purge gap', () => {
    const result = runRollingWalkForward(Array(60).fill([1, -.25]).flat(), { trainSize:40, testSize:20, stepSize:20, purgeSize:2 });
    expect(result.folds.length).toBeGreaterThan(1);
    expect(result.folds.every(fold => fold.testStart > fold.trainEnd)).toBe(true);
    expect(result.stable).toBe(true);
  });
});
