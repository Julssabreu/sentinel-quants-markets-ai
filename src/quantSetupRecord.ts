import type { MarketClass } from './marketArchitecture';
import type { SetupFeatureVector } from './setupFeatureEngine';
import type { SentinelQuantVersions } from './sentinelQuantVersions';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';
import type { SmcBacktestCandidate, SmcBacktestTrade } from './smcQuantBacktester';

export interface QuantSetupRecord {
  schemaVersion: 1;
  setupId: string;
  auditId: string;
  experimentId: string;
  datasetIds: Record<string, string>;
  instrumentId: string;
  symbol: string;
  assetClass: MarketClass;
  sourceTimestamp: string;
  receivedTimestamp: string;
  processingTimestamp: string;
  direction: 'LONG' | 'SHORT';
  features: SetupFeatureVector;
  entry: number | null;
  actualEntry: number | null;
  exit: number | null;
  entryTimestamp: string | null;
  exitTimestamp: string | null;
  exitReason: string | null;
  stop: number | null;
  target: number | null;
  plannedRR: number | null;
  spread: number | null;
  slippage: number | null;
  grossResultR: number | null;
  netResultR: number | null;
  riskPercent: number;
  grossResultPercent: number | null;
  netResultPercent: number | null;
  maeR: number | null;
  mfeR: number | null;
  quantStatusAtEntry: 'RESEARCH' | 'PROBATION' | 'PRELIMINARY' | 'ELIGIBLE' | 'BLOCKED';
  reasonCodes: string[];
  versions: SentinelQuantVersions;
  createdAt: string;
  profileId: string;
  resultStatus: 'PENDING' | 'COMPLETED' | 'NOT_EXECUTED';
}

export interface CreateQuantSetupRecordInput {
  experimentId: string;
  datasetIds: Record<string, string>;
  candidate: SmcBacktestCandidate;
  trade?: SmcBacktestTrade | null;
  receivedTimestamp: string;
  processingTimestamp: string;
  createdAt: string;
  spread: number | null;
  slippage: number | null;
  riskPercent?: number;
}

export function createQuantSetupRecord(input: CreateQuantSetupRecordInput): QuantSetupRecord {
  const { candidate, trade } = input;
  if (trade && trade.setupId !== candidate.setupId) throw new Error('Trade y candidato pertenecen a setupId diferentes.');
  if (!candidate.features.instrumentId || candidate.features.timestamp !== candidate.signalTimestamp)
    throw new Error('Features inconsistentes con el candidato.');
  return {
    schemaVersion:1, setupId:candidate.setupId, auditId:`AUDIT:${candidate.setupId}`,
    experimentId:input.experimentId, datasetIds:{ ...input.datasetIds },
    instrumentId:candidate.features.instrumentId, symbol:candidate.features.symbol, assetClass:candidate.features.assetClass,
    sourceTimestamp:candidate.signalTimestamp, receivedTimestamp:input.receivedTimestamp,
    processingTimestamp:input.processingTimestamp, direction:candidate.direction, features:candidate.features,
    entry:candidate.plannedEntry, actualEntry:trade?.entryFill ?? null, exit:trade?.exitFill ?? null,
    entryTimestamp:trade?.entryTimestamp ?? null, exitTimestamp:trade?.exitTimestamp ?? null,
    exitReason:trade?.exitReason ?? null, stop:candidate.plannedStop, target:candidate.plannedTarget,
    plannedRR:candidate.plannedRR, spread:trade?.entrySpreadPrice ?? input.spread, slippage:trade?.entrySlippagePrice ?? input.slippage,
    grossResultR:trade?.grossResultR ?? null, netResultR:trade?.netResultR ?? null,
    riskPercent:input.riskPercent??trade?.riskPercent??1, grossResultPercent:trade?.grossResultPercent ?? (trade?trade.grossResultR*(input.riskPercent??1):null), netResultPercent:trade?.netResultPercent ?? (trade?trade.netResultR*(input.riskPercent??1):null),
    maeR:trade?.maeR ?? null, mfeR:trade?.mfeR ?? null, quantStatusAtEntry:'RESEARCH',
    reasonCodes:trade ? ['QUANT_RESEARCH_ONLY', 'BACKTEST_TRADE_COMPLETED'] : ['QUANT_RESEARCH_ONLY', 'BACKTEST_NOT_EXECUTED'],
    versions:SENTINEL_QUANT_VERSIONS, createdAt:input.createdAt, profileId:candidate.profileId,
    resultStatus:trade ? 'COMPLETED' : 'NOT_EXECUTED',
  };
}
