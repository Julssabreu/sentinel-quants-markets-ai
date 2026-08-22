import { describe, expect, it } from 'vitest';
import { closedCandlesAt, createCausalCandleWindow, synchronizeTimeframesAt } from './multiTimeframeSynchronizer';
import { SimulationClock } from './simulationClock';
import type { Candle } from './analysisEngine';

const bar = (time: string): Candle => ({ time, open:100, high:101, low:99, close:100.5 });
describe('causal multi-timeframe synchronization', () => {
  it('does not expose an H1 candle before its close', () => {
    const rows = [bar('2026-01-01T10:00:00Z'), bar('2026-01-01T11:00:00Z')];
    expect(closedCandlesAt(rows, 'H1', '2026-01-01T10:35:00Z').closedCandles).toHaveLength(0);
    expect(closedCandlesAt(rows, 'H1', '2026-01-01T11:00:00Z').closedCandles).toHaveLength(1);
  });
  it('synchronizes M5 and H1 against one simulation clock', () => {
    const clock = new SimulationClock('2026-01-01T10:35:00Z');
    const result = synchronizeTimeframesAt({ H1:[bar('2026-01-01T10:00:00Z')], M5:[bar('2026-01-01T10:25:00Z'), bar('2026-01-01T10:30:00Z')] }, clock);
    expect(result.H1.closedCandles).toHaveLength(0);
    expect(result.M5.closedCandles).toHaveLength(2);
  });
  it('sorts closed input deterministically and rejects duplicate timestamps', () => {
    const rows = [bar('2026-01-01T10:05:00Z'), bar('2026-01-01T10:00:00Z')];
    expect(closedCandlesAt(rows, 'M5', '2026-01-01T10:10:00Z').closedCandles.map(item => item.time))
      .toEqual(['2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z']);
    expect(() => closedCandlesAt([rows[0], rows[0]], 'M5', '2026-01-01T10:10:00Z')).toThrow(/duplicados/);
  });
  it('creates an explicit point-in-time data window', () => {
    const clock = new SimulationClock('2026-01-01T10:35:00Z');
    const window = createCausalCandleWindow({ H1:[bar('2026-01-01T10:00:00Z')] }, clock);
    expect(window.availableAt).toBe('2026-01-01T10:35:00.000Z');
    expect(window.frames.H1.closedCandles).toHaveLength(0);
  });
});
