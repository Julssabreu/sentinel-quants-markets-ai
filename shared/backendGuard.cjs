const {
  MODEL_MANIFEST,
  MODEL_FINGERPRINT,
  simulationFingerprint,
} = require('./modelContract.cjs');

const RESOLVED = new Set(['TP2', 'STOP']);
const DIRECTIONS = new Set(['BUY', 'SELL']);
const DECISIONS = new Set([
  'BUY_CONDICIONADO',
  'SELL_CONDICIONADO',
  'ESPERAR',
  'NO_OPERAR_EVENTO',
]);
const TIMEFRAME_SECONDS = {
  M1:60,M2:120,M3:180,M4:240,M5:300,M6:360,M10:600,M12:720,M15:900,M20:1200,
  M30:1800,H1:3600,H2:7200,H3:10800,H4:14400,H6:21600,H8:28800,H12:43200,
  D1:86400,W1:604800,MN1:2678400,
};

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function compatibleSimulation(record) {
  return record?.modelId === MODEL_MANIFEST.modelId
    && record?.modelVersion === MODEL_MANIFEST.version
    && record?.modelFingerprint === MODEL_FINGERPRINT
    && Number(record?.schemaVersion) >= 3
    && record?.legacySemantics !== true
    && record?.simulationEligible === true
    && record?.planMode === 'SIMULATION'
    && record?.simulationFingerprint === simulationFingerprint(record)
    && Number.isFinite(Date.parse(String(record?.simulationAnchorTime || '')))
    && record?.plan?.mode === 'SIMULATED';
}

function compatibleResolved(records) {
  const unique = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!compatibleSimulation(record) || !RESOLVED.has(record?.outcome?.status)) continue;
    if (!unique.has(record.simulationFingerprint)) unique.set(record.simulationFingerprint, record);
  }
  return [...unique.values()].sort((left, right) =>
    String(left.createdAt || '').localeCompare(String(right.createdAt || '')),
  );
}

function performance(records) {
  const returns = records.map(record => record.outcome?.status === 'TP2' ? 2.5 : -1);
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    wins: wins.length,
    losses: losses.length,
    averageR: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : (wins.length ? Number.POSITIVE_INFINITY : 0),
  };
}

function deriveModelGovernance(records) {
  const ordered = compatibleResolved(records);
  const recent = ordered.slice(-30);
  const baseline = ordered.slice(0, -30);
  const recentStats = performance(recent);
  const baselineStats = baseline.length >= 30 ? performance(baseline) : null;
  const brierScore = recent.length
    ? recent.reduce((sum, record) => {
        const probability = Math.max(0, Math.min(
          1,
          Number(record.analyticalConfidence ?? record.confidence) / 100,
        ));
        const actual = record.outcome?.status === 'TP2' ? 1 : 0;
        return sum + (probability - actual) ** 2;
      }, 0) / recent.length
    : null;
  const drift = baselineStats ? recentStats.averageR - baselineStats.averageR : null;
  let status = 'RESEARCH';
  if (recent.length >= 30) {
    if (
      recentStats.averageR <= 0
      || recentStats.profitFactor < 1
      || (brierScore ?? 1) > 0.3
      || (drift !== null && drift < -0.5)
    ) status = 'SUSPENDED';
    else if (
      recentStats.averageR > 0
      && recentStats.profitFactor >= 1.15
      && (brierScore ?? 1) <= 0.25
    ) status = 'ACTIVE';
    else status = 'PROBATION';
  }
  return {
    status,
    sample: recent.length,
    canVote: status === 'ACTIVE' || status === 'PROBATION',
  };
}

function validatePlanContract(record) {
  const plan = record?.plan;
  if (
    record?.planMode !== 'SIMULATION'
    || !plan
    || plan.mode !== 'SIMULATED'
    || !DIRECTIONS.has(plan.direction)
    || ![plan.trigger, plan.maxEntry, plan.stop, plan.tp1, plan.tp2].every(finite)
    || !Number.isInteger(Number(plan.expiresAfterBars))
    || Number(plan.expiresAfterBars) < 1
    || Number(plan.expiresAfterBars) > 5000
  ) throw new Error('El contrato del plan simulado es invalido.');

  const trigger = Number(plan.trigger);
  const maxEntry = Number(plan.maxEntry);
  const stop = Number(plan.stop);
  const tp1 = Number(plan.tp1);
  const tp2 = Number(plan.tp2);
  const ordered = plan.direction === 'BUY'
    ? stop < trigger && trigger <= maxEntry && maxEntry < tp1 && tp1 < tp2
    : stop > trigger && trigger >= maxEntry && maxEntry > tp1 && tp1 > tp2;
  if (!ordered) throw new Error('Los niveles del plan simulado no respetan su direccion.');

  const expectedDecision = plan.direction === 'BUY' ? 'BUY_CONDICIONADO' : 'SELL_CONDICIONADO';
  if (record.analyticalDecision !== expectedDecision || record.decision !== expectedDecision) {
    throw new Error('La direccion del plan no coincide con la decision analitica.');
  }
  const anchor = Date.parse(String(record.simulationAnchorTime || ''));
  if (!Number.isFinite(anchor) || anchor > Date.now() + 5 * 60_000) {
    throw new Error('La barra ancla de la simulacion es invalida.');
  }
  if (record.simulationFingerprint !== simulationFingerprint(record)) {
    throw new Error('El fingerprint de simulacion no coincide con el contrato actual.');
  }
}

function prepareHistoryDraft(record, existingRecords) {
  if (!record || typeof record !== 'object') throw new Error('Registro de analisis invalido.');
  if (
    typeof record.symbol !== 'string'
    || !record.symbol.trim()
    || record.symbol.length > 80
    || typeof record.brokerSymbol !== 'string'
    || !record.brokerSymbol.trim()
    || record.brokerSymbol.length > 80
    || typeof record.timeframe !== 'string'
    || !/^(M1|M2|M3|M4|M5|M6|M10|M12|M15|M20|M30|H1|H2|H3|H4|H6|H8|H12|D1|W1|MN1)$/.test(record.timeframe)
  ) throw new Error('Identidad o temporalidad del analisis invalida.');
  if(typeof record.analysisFingerprint!=='string'||!/^FNV1A-[a-f0-9]{8}$/i.test(record.analysisFingerprint)){
    throw new Error('Fingerprint estable del analisis invalido.');
  }
  if (!DECISIONS.has(record.decision) || record.analyticalDecision !== record.decision) {
    throw new Error('Decision analitica invalida.');
  }
  const confidence = Number(record.analyticalConfidence ?? record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('Confianza analitica invalida.');
  }
  if (
    record.modelId !== MODEL_MANIFEST.modelId
    || record.modelVersion !== MODEL_MANIFEST.version
    || record.modelFingerprint !== MODEL_FINGERPRINT
  ) throw new Error('El registro no pertenece al modelo vigente.');
  if (record.executionAuthorized === true || record.executionStatus !== 'DISABLED') {
    throw new Error('Sentinel no acepta autoridad de ejecucion.');
  }

  const governance = deriveModelGovernance(existingRecords);
  const simulationEligible = record.simulationEligible === true;
  if (simulationEligible) {
    validatePlanContract(record);
    const anchor = Date.parse(String(record.simulationAnchorTime));
    const maximumAge = TIMEFRAME_SECONDS[record.timeframe] * 4 * 1000 + 3 * 86_400_000;
    if (Date.now() - anchor > maximumAge) {
      throw new Error('La barra ancla es demasiado antigua para una simulacion nueva.');
    }
  }
  if (record.recommendationAuthorized === true && (
    !simulationEligible
    || !governance.canVote
    || record.recommendationStatus !== 'MANUAL_REVIEW'
  )) throw new Error('La recomendacion no esta autorizada por la gobernanza vigente.');

  return {
    ...record,
    confidence,
    analyticalConfidence: confidence,
    maturityStatus: governance.status,
    maturitySample: governance.sample,
    executionStatus: 'DISABLED',
    executionAuthorized: false,
    simulationEligible,
    planMode: simulationEligible ? 'SIMULATION' : null,
    simulationFingerprint: simulationEligible ? record.simulationFingerprint : null,
    simulationAnchorTime: simulationEligible ? record.simulationAnchorTime : null,
    plan: simulationEligible ? {
      ...record.plan,
      trigger: Number(record.plan.trigger),
      maxEntry: Number(record.plan.maxEntry),
      stop: Number(record.plan.stop),
      tp1: Number(record.plan.tp1),
      tp2: Number(record.plan.tp2),
      expiresAfterBars: Number(record.plan.expiresAfterBars),
      mode: 'SIMULATED',
    } : null,
    outcome: null,
    lastEvaluationAttemptAt: null,
    lastEvaluationError: null,
  };
}

function trustedReviewRecord(payload, records) {
  if (!payload?.analysisRecordId) return null;
  const record = (Array.isArray(records) ? records : []).find(item => item.id === payload.analysisRecordId);
  if (!record || !compatibleSimulation(record)) return null;
  try { validatePlanContract(record); } catch { return null; }
  const governance = deriveModelGovernance(records);
  if (
    !governance.canVote
    || record.recommendationAuthorized !== true
    || record.recommendationStatus !== 'MANUAL_REVIEW'
    || record.executionAuthorized === true
    || String(record.symbol) !== String(payload.symbol)
    || String(record.timeframe) !== String(payload.timeframe)
  ) return null;
  return { record, governance };
}

module.exports = {
  compatibleSimulation,
  deriveModelGovernance,
  prepareHistoryDraft,
  trustedReviewRecord,
  validatePlanContract,
};
