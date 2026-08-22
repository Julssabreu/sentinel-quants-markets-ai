import { describe, expect, it } from 'vitest';
import { analyzeParameterStability, evaluateRobustness } from './robustnessEngine';

describe('robustness analysis', () => {
  it('flags scenarios that lose the baseline edge', () => {
    const result = evaluateRobustness([2, -1, 2, -1], [{ id:'2X_SPREAD', returns:[.1, -1, .1, -1] }]);
    expect(result[0].collapsed).toBe(true);
  });

  it('prefers stable parameter regions', () => {
    const result = analyzeParameterStability([
      { value:1, expectancyR:.3 },
      { value:1.2, expectancyR:.31 },
      { value:1.4, expectancyR:.29 },
    ]);
    expect(result.stable).toBe(true);
  });
});
