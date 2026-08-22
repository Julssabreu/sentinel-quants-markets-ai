import type { Candle } from './analysisEngine';
import type { QuantClock } from './simulationClock';

const UNITS: Record<string, number> = { M:60_000, H:3_600_000, D:86_400_000, W:604_800_000 };

export function timeframeDurationMs(timeframe: string): number {
  const match = timeframe.toUpperCase().match(/^(M|H|D|W)(\d+)?$/);
  if (!match) throw new Error(`Temporalidad no soportada: ${timeframe}`);
  return UNITS[match[1]] * Number(match[2] || 1);
}

export interface SynchronizedFrame {
  timeframe: string;
  closedCandles: Candle[];
  excludedOpenCandles: number;
  latestClosedAt: string | null;
}

export interface CausalCandleWindow {
  availableAt: string;
  frames: Record<string, SynchronizedFrame>;
}

/** Candle timestamps are treated as bar-open timestamps. */
export function closedCandlesAt(candles: readonly Candle[], timeframe: string, availableAt: string | number | Date): SynchronizedFrame {
  const now = new Date(availableAt).getTime();
  const duration = timeframeDurationMs(timeframe);
  if (!Number.isFinite(now)) throw new Error('Timestamp de sincronización inválido.');

  const valid = candles
    .map((bar, sourceIndex) => ({ bar, sourceIndex, open:Date.parse(bar.time) }))
    .filter(item => Number.isFinite(item.open));
  const seen = new Set<number>();
  for (const item of valid) {
    if (seen.has(item.open)) throw new Error(`Temporalidad ${timeframe} contiene timestamps duplicados.`);
    seen.add(item.open);
  }
  const closedCandles = valid
    .filter(item => item.open + duration <= now)
    .sort((a, b) => a.open - b.open || a.sourceIndex - b.sourceIndex)
    .map(item => item.bar);
  const latest = closedCandles.at(-1);
  return {
    timeframe:timeframe.toUpperCase(),
    closedCandles,
    excludedOpenCandles:candles.length - closedCandles.length,
    latestClosedAt:latest ? new Date(Date.parse(latest.time) + duration).toISOString() : null,
  };
}

export function synchronizeTimeframesAt(
  frames: Readonly<Record<string, readonly Candle[]>>,
  clock: QuantClock,
): Record<string, SynchronizedFrame> {
  return Object.fromEntries(Object.entries(frames).map(([timeframe, candles]) => [timeframe, closedCandlesAt(candles, timeframe, clock.now())]));
}

export function createCausalCandleWindow(
  frames: Readonly<Record<string, readonly Candle[]>>,
  clock: QuantClock,
): CausalCandleWindow {
  return { availableAt:clock.nowIso(), frames:synchronizeTimeframesAt(frames, clock) };
}
