import type { Candle } from './analysisEngine';

export interface LeakageCheckResult {
  invariant: boolean;
  fullResult: unknown;
  cutResult: unknown;
  availableDataUntilTimestamp: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function verifyPointInTimeInvariant<TItem,TResult>(fullDataset:readonly TItem[],availableDataUntilTimestamp:string,availableAt:(item:TItem)=>string,compute:(items:readonly TItem[],availableDataUntilTimestamp:string)=>TResult):LeakageCheckResult{
  const availableMs=Date.parse(availableDataUntilTimestamp);if(!Number.isFinite(availableMs))throw new Error('availableDataUntilTimestamp inválido.');
  const cutDataset=fullDataset.filter(item=>Date.parse(availableAt(item))<=availableMs),fullResult=compute(fullDataset,availableDataUntilTimestamp),cutResult=compute(cutDataset,availableDataUntilTimestamp);
  return{invariant:stable(fullResult)===stable(cutResult),fullResult,cutResult,availableDataUntilTimestamp};
}

export function verifyFeatureCutAtTInvariant<T>(
  fullDataset: readonly Candle[],
  availableDataUntilTimestamp: string,
  compute: (candles: readonly Candle[], availableDataUntilTimestamp: string) => T,
): LeakageCheckResult {
  const availableMs = Date.parse(availableDataUntilTimestamp);
  if (!Number.isFinite(availableMs)) throw new Error('availableDataUntilTimestamp inválido.');
  const cutDataset = fullDataset.filter(bar => Date.parse(bar.time) <= availableMs);
  const fullResult = compute(fullDataset, availableDataUntilTimestamp);
  const cutResult = compute(cutDataset, availableDataUntilTimestamp);
  return { invariant:stable(fullResult) === stable(cutResult), fullResult, cutResult, availableDataUntilTimestamp };
}
