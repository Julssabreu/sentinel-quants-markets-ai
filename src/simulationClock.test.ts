import { describe, expect, it } from 'vitest';
import { SimulationClock } from './simulationClock';

describe('SimulationClock', () => {
  it('is deterministic and monotonic', () => {
    const clock = new SimulationClock('2026-01-01T10:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(clock.nowIso()).toBe('2026-01-01T10:00:00.000Z');
    clock.advanceTo('2026-01-01T10:05:00Z');
    expect(clock.nowMs()).toBe(Date.parse('2026-01-01T10:05:00Z'));
    expect(() => clock.advanceTo('2026-01-01T10:04:00Z')).toThrow(/retroceder/);
  });
});
