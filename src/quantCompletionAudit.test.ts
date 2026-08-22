import{describe,expect,it}from'vitest';
import{auditQuantImplementation,createQuantCompletionEvidence,SENTINEL_QUANT_IMPLEMENTATION_AUDIT,type QuantCompletionSnapshot}from'./quantCompletionAudit';

const complete:QuantCompletionSnapshot={
  dataset:{checksumVerified:true,identityVerified:true,dateFilterVerified:true},research:{backtestPersistedAndVerified:true,causalInvariantPassed:true,backendAuthorityVerified:true},
  validation:{oosSealed:true,intervalPurgeVerified:true,walkForwardClaimIsDiagnostic:true,derivedBackendAuthorityVerified:true},
  runtime:{paperPipelineWired:true,shadowPipelineWired:true,paperJournalEntries:1,shadowJournalEntries:1},
  safety:{runtimeGateWired:true,killSwitchPersistent:true,circuitBreakerUsesMeasuredInputs:true},
  observability:{ledgerVerified:true,healthJournalEntries:1,rotationConfigured:true},
  forward:{restartRecoveryVerified:true,deduplicationVerified:true,closedBarOnly:true},
  ui:{traceabilityViewVerified:true,runtimeStateMatchesStorage:true},
  release:{commands:[{id:'vitest',passed:true},{id:'build',passed:true}],installedArtifactVerified:true},
};

describe('Quant completion audit ejecutable',()=>{
  it('no declara nada completo sin evidencia medida',()=>expect(SENTINEL_QUANT_IMPLEMENTATION_AUDIT).toMatchObject({status:'INCOMPLETE',completedBlocks:0}));
  it('completa únicamente cuando cada comprobación observada pasa y tiene artefacto',()=>expect(auditQuantImplementation(createQuantCompletionEvidence(complete))).toMatchObject({status:'IMPLEMENTATION_COMPLETE',completedBlocks:8,missingBlocks:[]}));
  it('detecta journals vacíos aunque existan nombres de módulos',()=>{const evidence=createQuantCompletionEvidence({...complete,runtime:{...complete.runtime,paperJournalEntries:0}}),audit=auditQuantImplementation(evidence);expect(audit.missingBlocks).toContain('PAPER_SHADOW');expect(audit.reasonCodes).toContain('COMPLETION_CHECK_FAILED:PAPER_SHADOW:PAPER_JOURNAL_HAS_FIELD_EVIDENCE')});
  it('detecta un comando de release fallido',()=>{const evidence=createQuantCompletionEvidence({...complete,release:{...complete.release,commands:[{id:'vitest',passed:false}]}});expect(auditQuantImplementation(evidence).missingBlocks).toContain('VERIFICATION_RELEASE')});
});
