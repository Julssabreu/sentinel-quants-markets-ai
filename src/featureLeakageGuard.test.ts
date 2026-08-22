import { describe, expect, it } from 'vitest';
import { verifyFeatureCutAtTInvariant,verifyPointInTimeInvariant } from './featureLeakageGuard';
import type { Candle } from './analysisEngine';

const rows: Candle[] = [1, 2, 3].map(day => ({ time:`2026-01-0${day}T00:00:00Z`, open:day, high:day, low:day, close:day }));
describe('feature leakage guard', () => {
  it('accepts a causal feature and detects a future-dependent feature', () => {
    const causal = verifyFeatureCutAtTInvariant(rows, '2026-01-02T00:00:00Z', (candles, available) => candles.filter(bar => bar.time <= available).at(-1)?.close);
    const leaking = verifyFeatureCutAtTInvariant(rows, '2026-01-02T00:00:00Z', candles => candles.at(-1)?.close);
    expect(causal.invariant).toBe(true);
    expect(leaking.invariant).toBe(false);
  });
  it('detects a feature that reads news received after T',()=>{const news=[{received:'2026-01-01Z',value:1},{received:'2026-01-03Z',value:9}];expect(verifyPointInTimeInvariant(news,'2026-01-02Z',item=>item.received,items=>items.at(-1)?.value).invariant).toBe(false);expect(verifyPointInTimeInvariant(news,'2026-01-02Z',item=>item.received,(items,t)=>items.filter(item=>item.received<=t).at(-1)?.value).invariant).toBe(true)});
});
