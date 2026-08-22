import type { Candle } from './analysisEngine';

export type DataQualityStatus = 'DATA_VALID' | 'DATA_WARNING' | 'DATA_DEGRADED' | 'DATA_INVALID';
export type DataQualityCode =
  | 'EMPTY_DATASET' | 'INVALID_TIMESTAMP' | 'DUPLICATE_TIMESTAMP' | 'OUT_OF_ORDER'
  | 'INVALID_OHLC' | 'NON_POSITIVE_PRICE' | 'NEGATIVE_SPREAD' | 'INVALID_VOLUME'
  | 'ABNORMAL_GAP' | 'MISSING_INTERVALS';

export interface DataQualityIssue {
  code: DataQualityCode;
  severity: 'WARNING' | 'ERROR';
  index: number | null;
  timestamp: string | null;
  detail: string;
}

export interface DataQualityReport {
  status: DataQualityStatus;
  rows: number;
  validRows: number;
  inferredIntervalMs: number | null;
  missingIntervals: number;
  issues: DataQualityIssue[];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function evaluateCandleDataQuality(candles: readonly Candle[]): DataQualityReport {
  if (!candles.length) return {
    status: 'DATA_INVALID', rows: 0, validRows: 0, inferredIntervalMs: null, missingIntervals: 0,
    issues: [{ code:'EMPTY_DATASET', severity:'ERROR', index:null, timestamp:null, detail:'El dataset no contiene velas.' }],
  };
  const issues: DataQualityIssue[] = [], timestamps: number[] = [], seen = new Set<number>();
  let validRows = 0;
  candles.forEach((bar, index) => {
    const timestamp = Date.parse(bar.time);
    const add = (code: DataQualityCode, severity: DataQualityIssue['severity'], detail: string) =>
      issues.push({ code, severity, index, timestamp:bar.time || null, detail });
    if (!Number.isFinite(timestamp)) add('INVALID_TIMESTAMP', 'ERROR', 'Timestamp inválido.');
    else {
      if (seen.has(timestamp)) add('DUPLICATE_TIMESTAMP', 'ERROR', 'Timestamp duplicado.');
      if (timestamps.length && timestamp < timestamps.at(-1)!) add('OUT_OF_ORDER', 'ERROR', 'Las velas no están ordenadas cronológicamente.');
      seen.add(timestamp); timestamps.push(timestamp);
    }
    const prices = [bar.open, bar.high, bar.low, bar.close];
    const finite = prices.every(Number.isFinite), positive = prices.every(value => value > 0);
    if (!finite || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high))
      add('INVALID_OHLC', 'ERROR', 'Relación OHLC imposible o valor no finito.');
    else if (!positive) add('NON_POSITIVE_PRICE', 'ERROR', 'Precio no positivo.');
    if (bar.spread != null && (!Number.isFinite(bar.spread) || bar.spread < 0)) add('NEGATIVE_SPREAD', 'ERROR', 'Spread negativo o inválido.');
    if ([bar.tickVolume, bar.realVolume].some(value => value != null && (!Number.isFinite(value) || value < 0)))
      add('INVALID_VOLUME', 'WARNING', 'Volumen negativo o inválido.');
    if (finite && positive) validRows++;
  });
  const deltas = timestamps.slice(1).map((time, index) => time - timestamps[index]).filter(value => value > 0);
  const interval = median(deltas), inferredIntervalMs = Number.isFinite(interval) ? interval : null;
  let missingIntervals = 0;
  if (inferredIntervalMs) {
    deltas.forEach((delta, index) => {
      if (delta > inferredIntervalMs * 1.5) {
        const missing = Math.max(1, Math.round(delta / inferredIntervalMs) - 1);
        missingIntervals += missing;
        issues.push({ code:'MISSING_INTERVALS', severity:'WARNING', index:index + 1, timestamp:candles[index + 1].time, detail:`Posible hueco de ${missing} intervalos.` });
      }
      if (delta > inferredIntervalMs * 20)
        issues.push({ code:'ABNORMAL_GAP', severity:'WARNING', index:index + 1, timestamp:candles[index + 1].time, detail:'Gap temporal extremo; puede corresponder a cierre de mercado o datos faltantes.' });
    });
  }
  const errors = issues.filter(issue => issue.severity === 'ERROR').length;
  const warningRatio = issues.filter(issue => issue.severity === 'WARNING').length / candles.length;
  const status: DataQualityStatus = errors ? 'DATA_INVALID' : warningRatio > .1 ? 'DATA_DEGRADED' : issues.length ? 'DATA_WARNING' : 'DATA_VALID';
  return { status, rows:candles.length, validRows, inferredIntervalMs, missingIntervals, issues };
}
