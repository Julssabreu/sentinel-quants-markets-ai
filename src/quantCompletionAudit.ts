export type CompletionBlock='CAUSAL_RESEARCH'|'VALIDATION_GOVERNANCE'|'PAPER_SHADOW'|'OPERATIONAL_SAFETY'|'DURABLE_OBSERVABILITY'|'FORWARD_PIPELINE'|'UI_TRACEABILITY'|'VERIFICATION_RELEASE';
export interface CompletionCheck{id:string;passed:boolean;artifactId?:string;detail?:string;}
export interface CompletionBlockEvidence{block:CompletionBlock;checks:readonly CompletionCheck[];}

export interface QuantCompletionSnapshot{
  dataset:{checksumVerified:boolean;identityVerified:boolean;dateFilterVerified:boolean};
  research:{backtestPersistedAndVerified:boolean;causalInvariantPassed:boolean;backendAuthorityVerified:boolean};
  validation:{oosSealed:boolean;intervalPurgeVerified:boolean;walkForwardClaimIsDiagnostic:boolean;derivedBackendAuthorityVerified:boolean};
  runtime:{paperPipelineWired:boolean;shadowPipelineWired:boolean;paperJournalEntries:number;shadowJournalEntries:number};
  safety:{runtimeGateWired:boolean;killSwitchPersistent:boolean;circuitBreakerUsesMeasuredInputs:boolean};
  observability:{ledgerVerified:boolean;healthJournalEntries:number;rotationConfigured:boolean};
  forward:{restartRecoveryVerified:boolean;deduplicationVerified:boolean;closedBarOnly:boolean};
  ui:{traceabilityViewVerified:boolean;runtimeStateMatchesStorage:boolean};
  release:{commands:readonly {id:string;passed:boolean}[];installedArtifactVerified:boolean};
}

const REQUIRED:CompletionBlock[]=['CAUSAL_RESEARCH','VALIDATION_GOVERNANCE','PAPER_SHADOW','OPERATIONAL_SAFETY','DURABLE_OBSERVABILITY','FORWARD_PIPELINE','UI_TRACEABILITY','VERIFICATION_RELEASE'];
const check=(id:string,passed:boolean,artifactId?:string):CompletionCheck=>({id,passed,artifactId});

export function createQuantCompletionEvidence(snapshot:QuantCompletionSnapshot):CompletionBlockEvidence[]{
  return[
    {block:'CAUSAL_RESEARCH',checks:[check('DATASET_CHECKSUM_VERIFIED',snapshot.dataset.checksumVerified,'dataset-checksum'),check('DATASET_IDENTITY_VERIFIED',snapshot.dataset.identityVerified,'dataset-identity'),check('DATE_FILTER_VERIFIED',snapshot.dataset.dateFilterVerified,'date-filter'),check('CAUSAL_INVARIANT_PASSED',snapshot.research.causalInvariantPassed,'causal-invariant'),check('BACKEND_AUTHORITY_VERIFIED',snapshot.research.backendAuthorityVerified,'quant-backend'),check('BACKTEST_PERSISTED_AND_VERIFIED',snapshot.research.backtestPersistedAndVerified,'backtest-result')]},
    {block:'VALIDATION_GOVERNANCE',checks:[check('OOS_SEALED',snapshot.validation.oosSealed,'oos-lock'),check('INTERVAL_PURGE_VERIFIED',snapshot.validation.intervalPurgeVerified,'interval-purge'),check('WALK_FORWARD_CLAIM_HONEST',snapshot.validation.walkForwardClaimIsDiagnostic,'walk-forward-methodology'),check('DERIVED_BACKEND_AUTHORITY_VERIFIED',snapshot.validation.derivedBackendAuthorityVerified,'quant-derived-backend')]},
    {block:'PAPER_SHADOW',checks:[check('PAPER_PIPELINE_WIRED',snapshot.runtime.paperPipelineWired,'paper-runtime'),check('SHADOW_PIPELINE_WIRED',snapshot.runtime.shadowPipelineWired,'shadow-runtime'),check('PAPER_JOURNAL_HAS_FIELD_EVIDENCE',snapshot.runtime.paperJournalEntries>0,'paper-journal'),check('SHADOW_JOURNAL_HAS_FIELD_EVIDENCE',snapshot.runtime.shadowJournalEntries>0,'shadow-journal')]},
    {block:'OPERATIONAL_SAFETY',checks:[check('RUNTIME_GATE_WIRED',snapshot.safety.runtimeGateWired,'runtime-safety-gate'),check('KILL_SWITCH_PERSISTENT',snapshot.safety.killSwitchPersistent,'kill-switch-state'),check('CIRCUIT_BREAKER_MEASURED',snapshot.safety.circuitBreakerUsesMeasuredInputs,'circuit-breaker-inputs')]},
    {block:'DURABLE_OBSERVABILITY',checks:[check('LEDGER_VERIFIED',snapshot.observability.ledgerVerified,'evidence-ledger'),check('HEALTH_JOURNAL_HAS_EVIDENCE',snapshot.observability.healthJournalEntries>0,'health-journal'),check('ROTATION_CONFIGURED',snapshot.observability.rotationConfigured,'retention-policy')]},
    {block:'FORWARD_PIPELINE',checks:[check('RESTART_RECOVERY_VERIFIED',snapshot.forward.restartRecoveryVerified,'restart-recovery'),check('DEDUPLICATION_VERIFIED',snapshot.forward.deduplicationVerified,'runtime-deduplication'),check('CLOSED_BAR_ONLY',snapshot.forward.closedBarOnly,'closed-bar-policy')]},
    {block:'UI_TRACEABILITY',checks:[check('TRACEABILITY_VIEW_VERIFIED',snapshot.ui.traceabilityViewVerified,'traceability-view'),check('UI_MATCHES_DURABLE_STATE',snapshot.ui.runtimeStateMatchesStorage,'ui-storage-consistency')]},
    {block:'VERIFICATION_RELEASE',checks:[...snapshot.release.commands.map(command=>check(`COMMAND:${command.id}`,command.passed,`verification:${command.id}`)),check('INSTALLED_ARTIFACT_VERIFIED',snapshot.release.installedArtifactVerified,'installed-artifact')]},
  ];
}

export function auditQuantImplementation(blocks:readonly CompletionBlockEvidence[]){
  const byId=new Map(blocks.map(item=>[item.block,item]));
  const evaluated=REQUIRED.map(block=>{
    const evidence=byId.get(block),checks=evidence?.checks??[];
    const implemented=checks.length>0&&checks.every(item=>item.passed&&Boolean(item.artifactId));
    return{block,implemented,checks,failedChecks:checks.filter(item=>!item.passed||!item.artifactId).map(item=>item.id)};
  });
  const missing=evaluated.filter(item=>!item.implemented).map(item=>item.block);
  return{
    schemaVersion:2 as const,status:missing.length?'INCOMPLETE' as const:'IMPLEMENTATION_COMPLETE' as const,
    requiredBlocks:REQUIRED.length,completedBlocks:REQUIRED.length-missing.length,missingBlocks:missing,
    checks:evaluated,artifactIds:[...new Set(evaluated.flatMap(item=>item.checks.map(check=>check.artifactId).filter((id):id is string=>Boolean(id))))],
    reasonCodes:evaluated.flatMap(item=>item.failedChecks.length?item.failedChecks.map(id=>`COMPLETION_CHECK_FAILED:${item.block}:${id}`):item.implemented?[]:[`COMPLETION_EVIDENCE_MISSING:${item.block}`]),
    fieldEvidenceStillRequired:missing.includes('PAPER_SHADOW'),liveEnabled:false as const,executionAuthorized:false as const,
  };
}

// Startup baseline: unknown runtime state is incomplete until measured evidence is supplied.
export const SENTINEL_QUANT_IMPLEMENTATION_AUDIT=auditQuantImplementation([]);
