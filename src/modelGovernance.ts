import { calculatePerformance } from './performanceStats';
import modelManifest from '../shared/modelManifest.json';

export type ModelStatus = 'RESEARCH' | 'PROBATION' | 'ACTIVE' | 'SUSPENDED';

export interface ModelGovernance {
  modelId: string;
  version: string;
  fingerprint: string;
  status: ModelStatus;
  sample: number;
  brierScore: number | null;
  recentAverageR: number;
  baselineAverageR: number | null;
  drift: number | null;
  reasons: string[];
  canVote: boolean;
}

export const MODEL_MANIFEST = modelManifest;

export function modelFingerprint(manifest: object = MODEL_MANIFEST) {
  const value = JSON.stringify(manifest);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `FNV1A-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function simulationFingerprint(record:Pick<AnalysisHistoryRecord,
  'symbol'|'brokerSymbol'|'timeframe'|'simulationAnchorTime'|'plan'|'strategy'>) {
  return modelFingerprint({
    model:modelFingerprint(),
    symbol:record.brokerSymbol||record.symbol,
    timeframe:record.timeframe,
    anchor:record.simulationAnchorTime,
    direction:record.plan?.direction,
    trigger:record.plan?.trigger,
    maxEntry:record.plan?.maxEntry,
    stop:record.plan?.stop,
    tp1:record.plan?.tp1,
    tp2:record.plan?.tp2,
    expiresAfterBars:record.plan?.expiresAfterBars,
    strategy:record.strategy,
  });
}

const resolved = (record: AnalysisHistoryRecord) =>
  record.outcome?.status === 'TP2' || record.outcome?.status === 'STOP';

const compatibleSimulation = (record:AnalysisHistoryRecord) =>
  record.modelId === MODEL_MANIFEST.modelId
  && record.modelVersion === MODEL_MANIFEST.version
  && record.modelFingerprint === modelFingerprint()
  && record.schemaVersion >= 3
  && record.legacySemantics !== true
  && record.simulationEligible === true
  && record.planMode === 'SIMULATION'
  && record.simulationFingerprint === simulationFingerprint(record)
  && Number.isFinite(Date.parse(String(record.simulationAnchorTime ?? '')))
  && record.plan?.mode === 'SIMULATED';

export function selectCompatibleSimulations(
  records:AnalysisHistoryRecord[],
  options:{resolvedOnly?:boolean}={},
):AnalysisHistoryRecord[]{
  const candidates=records.filter((record)=>compatibleSimulation(record)&&(!options.resolvedOnly||resolved(record)));
  const unique=new Map<string,AnalysisHistoryRecord>();
  for(const record of candidates){
    const key=record.simulationFingerprint!;
    const previous=unique.get(key);
    if(!previous||resolved(record)&&!resolved(previous))unique.set(key,record);
  }
  return [...unique.values()];
}

export function evaluateModelGovernance(records: AnalysisHistoryRecord[]): ModelGovernance {
  const fingerprint = modelFingerprint();
  const resolvedRecords = records.filter(resolved);
  const compatibleCandidates = resolvedRecords.filter(compatibleSimulation);
  const compatibleRecords=selectCompatibleSimulations(records,{resolvedOnly:true});
  const excludedRecords = resolvedRecords.length - compatibleCandidates.length;
  const duplicateRecords=compatibleCandidates.length-compatibleRecords.length;
  const ordered = compatibleRecords.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = ordered.slice(-30);
  const baseline = ordered.slice(0, -30);
  const recentStats = calculatePerformance(recent);
  const baselineStats = baseline.length >= 30 ? calculatePerformance(baseline) : null;
  const effectiveProfitFactor = recentStats.losses === 0 && recentStats.wins > 0
    ? Number.POSITIVE_INFINITY
    : recentStats.profitFactor ?? 0;
  const brier = recent.length
    ? recent.reduce((sum, record) => {
        const probability = Math.max(0, Math.min(1, (record.analyticalConfidence ?? record.confidence) / 100));
        const actual = record.outcome?.status === 'TP2' ? 1 : 0;
        return sum + (probability - actual) ** 2;
      }, 0) / recent.length
    : null;
  const drift = baselineStats ? recentStats.averageR - baselineStats.averageR : null;
  const reasons: string[] = [];
  let status: ModelStatus = 'RESEARCH';

  if (recent.length < 30) {
    reasons.push(`Muestra insuficiente: ${recent.length}/30 resultados recientes.`);
  } else if (
    recentStats.averageR <= 0 ||
    effectiveProfitFactor < 1 ||
    (brier ?? 1) > 0.3 ||
    (drift !== null && drift < -0.5)
  ) {
    status = 'SUSPENDED';
    reasons.push('Degradación en expectativa, profit factor, calibración o estabilidad reciente.');
  } else if (
    recentStats.averageR > 0 &&
    effectiveProfitFactor >= 1.15 &&
    (brier ?? 1) <= 0.25
  ) {
    status = 'ACTIVE';
    reasons.push('Cumple muestra, expectativa, profit factor y calibración mínima.');
  } else {
    status = 'PROBATION';
    reasons.push('La evidencia es positiva, pero aún no cumple todos los umbrales de producción.');
  }

  if (excludedRecords > 0) {
    reasons.push(
      `Se excluyeron ${excludedRecords} resultados de versiones anteriores o sin fingerprint.`,
    );
  }
  if(duplicateRecords>0){
    reasons.push(`Se ignoraron ${duplicateRecords} resultados duplicados de la misma simulación.`);
  }

  return {
    modelId: MODEL_MANIFEST.modelId,
    version: MODEL_MANIFEST.version,
    fingerprint,
    status,
    sample: recent.length,
    brierScore: brier,
    recentAverageR: recentStats.averageR,
    baselineAverageR: baselineStats?.averageR ?? null,
    drift,
    reasons,
    canVote: status === 'ACTIVE' || status === 'PROBATION',
  };
}
