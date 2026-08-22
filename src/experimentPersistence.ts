import type { QuantExperimentRecord } from './experimentRegistry';

export interface ExperimentAppendStore { append(kind:'experiment', payload:QuantExperimentRecord):Promise<unknown>; }
export async function persistExperiment(record: QuantExperimentRecord, store: ExperimentAppendStore) {
  return store.append('experiment', record);
}
