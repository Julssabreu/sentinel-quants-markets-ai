import { createQuantSetupRecord, type QuantSetupRecord } from './quantSetupRecord';
import type { SmcBacktestResult } from './smcQuantBacktester';

export interface QuantSetupAppendStore {
  append(kind:'setup', payload:QuantSetupRecord): Promise<unknown>;
}

export async function persistBacktestSetups(
  result: SmcBacktestResult,
  store: QuantSetupAppendStore,
  costs: { spread:number | null; slippage:number | null },
): Promise<QuantSetupRecord[]> {
  const records: QuantSetupRecord[] = [];
  for (const candidate of result.candidates) {
    const trade = result.trades.find(item => item.setupId === candidate.setupId) ?? null;
    const record = createQuantSetupRecord({
      experimentId:result.experimentId, datasetIds:result.datasetIds, candidate, trade,
      receivedTimestamp:candidate.signalTimestamp, processingTimestamp:candidate.signalTimestamp,
      createdAt:candidate.signalTimestamp, spread:costs.spread, slippage:costs.slippage,
    });
    await store.append('setup', record);
    records.push(record);
  }
  return records;
}
