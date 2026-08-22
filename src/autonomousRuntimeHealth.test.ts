import{describe,expect,it}from'vitest';
// @ts-expect-error CommonJS production module.
import healthModule from'../shared/autonomousRuntimeHealth.cjs';

const NOW=Date.parse('2026-08-17T12:00:00.000Z');
const heartbeat=(overrides:Record<string,unknown>={})=>({heartbeat:{state:'READY',checkedAt:new Date(NOW).toISOString(),nextIntervalMinutes:2,paperJournalEvents:4,shadowJournalEvents:5,liveOrderSent:false,executionAuthorized:false,...overrides}});

describe('autonomous runtime operational health',()=>{
  it('no permite que un MT5 sano oculte un heartbeat ausente o obsoleto',()=>{
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat({},NOW,{applicationStartedAt:NOW-60_000})).toMatchObject({status:'DEGRADED',reasonCodes:['AUTONOMOUS_RUNTIME_HEARTBEAT_MISSING']});
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat({},NOW,{applicationStartedAt:NOW-10*60_000})).toMatchObject({status:'ERROR',reasonCodes:['AUTONOMOUS_RUNTIME_HEARTBEAT_MISSING']});
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat(heartbeat({checkedAt:new Date(NOW-10*60_000).toISOString()}),NOW,{applicationStartedAt:NOW})).toMatchObject({status:'ERROR',reasonCodes:['AUTONOMOUS_RUNTIME_HEARTBEAT_STALE']});
  });
  it('exige ambos invariantes de no ejecucion y refleja estados degradados',()=>{
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat(heartbeat(),NOW,{applicationStartedAt:NOW-10*60_000})).toMatchObject({ok:true,status:'HEALTHY'});
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat(heartbeat({liveOrderSent:true}),NOW,{applicationStartedAt:NOW-10*60_000})).toMatchObject({status:'ERROR',reasonCodes:['AUTONOMOUS_RUNTIME_UNSAFE_HEARTBEAT']});
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat(heartbeat({executionAuthorized:true}),NOW,{applicationStartedAt:NOW-10*60_000})).toMatchObject({status:'ERROR',reasonCodes:['AUTONOMOUS_RUNTIME_UNSAFE_HEARTBEAT']});
    expect(healthModule.evaluateAutonomousRuntimeHeartbeat(heartbeat({state:'DEGRADED'}),NOW,{applicationStartedAt:NOW-10*60_000})).toMatchObject({status:'DEGRADED',reasonCodes:['AUTONOMOUS_RUNTIME_DEGRADED']});
  });
  it('separa carreras transitorias, corrupcion y RECOVERY_GAP durable por journal',()=>{
    const runtime=healthModule.evaluateAutonomousRuntimeHeartbeat(heartbeat(),NOW,{applicationStartedAt:NOW-10*60_000});
    const value={...heartbeat().heartbeat,paperSafe:true,shadowSafe:true,paperCount:4,shadowCount:5,paperRecoveryGap:false,shadowRecoveryGap:false,heartbeat:heartbeat().heartbeat};
    expect(healthModule.evaluateRuntimeJournal(value,'PAPER',runtime)).toMatchObject({status:'HEALTHY'});
    expect(healthModule.evaluateRuntimeJournal({...value,paperCount:5},'PAPER',runtime)).toMatchObject({status:'DEGRADED',reasonCodes:['PAPER_JOURNAL_HEARTBEAT_PENDING']});
    expect(healthModule.evaluateRuntimeJournal({...value,paperCount:3},'PAPER',runtime)).toMatchObject({status:'ERROR',reasonCodes:['PAPER_JOURNAL_HEARTBEAT_MISMATCH']});
    expect(healthModule.evaluateRuntimeJournal({...value,shadowRecoveryGap:true},'SHADOW',runtime)).toMatchObject({status:'DEGRADED',reasonCodes:['SHADOW_RECOVERY_GAP']});
    expect(healthModule.evaluateRuntimeJournal({...value,shadowSafe:false},'SHADOW',runtime)).toMatchObject({status:'ERROR',reasonCodes:['SHADOW_LIVE_ORDER_INVARIANT_BROKEN']});
  });
});
