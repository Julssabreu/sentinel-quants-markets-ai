import type { DatasetProvenance } from './dataProvenance';
import { SENTINEL_QUANT_VERSIONS, type SentinelQuantVersions } from './sentinelQuantVersions';

export type ExperimentStatus = 'CREATED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'REJECTED';
export interface QuantExperimentRecord {
  schemaVersion: 1;
  experimentId: string;
  familyId: string;
  hypothesis: string;
  datasetIds: string[];
  datasetChecksums: Record<string, string>;
  strategyVersion: string;
  featureSetVersion: string;
  quantModelVersion: string;
  riskModelVersion: string;
  executionModelVersion: string;
  parameters: Record<string, unknown>;
  timeframes: string[];
  instrumentId: string;
  assetClass: string;
  dateRange: { from:string; to:string };
  randomSeed: number;
  codeVersion: string;
  commitHash: string | null;
  runTimestamp: string;
  environmentVersion: string;
  versions: SentinelQuantVersions;
  status: ExperimentStatus;
}

export function createExperimentRecord(input: {
  experimentId:string; familyId:string; hypothesis:string; datasets:readonly DatasetProvenance[];
  parameters:Record<string, unknown>; timeframes:string[]; instrumentId:string; assetClass:string;
  dateRange:{ from:string; to:string }; randomSeed:number; codeVersion:string; commitHash?:string | null;
  runTimestamp:string; environmentVersion:string; status?:ExperimentStatus; featureSetVersion?:string;
}): QuantExperimentRecord {
  if (!input.experimentId.trim() || !input.familyId.trim() || !input.hypothesis.trim()) throw new Error('Experimento requiere id, familia e hipótesis.');
  if (!input.datasets.length) throw new Error('Experimento requiere al menos un dataset con procedencia.');
  if (input.datasets.some(dataset => dataset.qualityStatus === 'DATA_INVALID')) throw new Error('Un experimento Quant no puede usar DATA_INVALID.');
  if (!Number.isInteger(input.randomSeed)) throw new Error('randomSeed debe ser entero.');
  return {
    schemaVersion:1, experimentId:input.experimentId, familyId:input.familyId, hypothesis:input.hypothesis,
    datasetIds:input.datasets.map(dataset => dataset.datasetId),
    datasetChecksums:Object.fromEntries(input.datasets.map(dataset => [dataset.datasetId, dataset.checksum])),
    strategyVersion:SENTINEL_QUANT_VERSIONS.smcStrategy, featureSetVersion:input.featureSetVersion ?? SENTINEL_QUANT_VERSIONS.featureSet,
    quantModelVersion:SENTINEL_QUANT_VERSIONS.quantModel, riskModelVersion:SENTINEL_QUANT_VERSIONS.riskModel,
    executionModelVersion:SENTINEL_QUANT_VERSIONS.executionModel, parameters:{ ...input.parameters },
    timeframes:[...input.timeframes], instrumentId:input.instrumentId, assetClass:input.assetClass,
    dateRange:{ ...input.dateRange }, randomSeed:input.randomSeed, codeVersion:input.codeVersion,
    commitHash:input.commitHash ?? null, runTimestamp:input.runTimestamp, environmentVersion:input.environmentVersion,
    versions:SENTINEL_QUANT_VERSIONS, status:input.status ?? 'CREATED',
  };
}
