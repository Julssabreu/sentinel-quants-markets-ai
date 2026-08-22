'use strict';

function evaluateAutonomousRuntimeHeartbeat(value,nowMs=Date.now(),options={}){
  const heartbeat=value?.heartbeat,heartbeatAt=Date.parse(String(heartbeat?.checkedAt||''));
  const applicationStartedAt=Number.isFinite(options.applicationStartedAt)?options.applicationStartedAt:nowMs;
  const bootstrapMs=Number.isFinite(options.bootstrapMs)?Math.max(0,options.bootstrapMs):5*60_000;
  const bootstrap=nowMs-applicationStartedAt<bootstrapMs,age=nowMs-heartbeatAt;
  const maxAge=Math.max(5*60_000,(Number(heartbeat?.nextIntervalMinutes)||2)*2*60_000+60_000);
  if(!heartbeat||!Number.isFinite(heartbeatAt))return{ok:false,status:bootstrap?'DEGRADED':'ERROR',lastHeartbeat:null,reasonCodes:['AUTONOMOUS_RUNTIME_HEARTBEAT_MISSING']};
  if(heartbeat.liveOrderSent!==false||heartbeat.executionAuthorized!==false)return{ok:false,status:'ERROR',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_UNSAFE_HEARTBEAT']};
  if(age< -2*60_000)return{ok:false,status:'ERROR',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_CLOCK_INVALID']};
  if(age>maxAge)return{ok:false,status:'ERROR',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_HEARTBEAT_STALE']};
  if(heartbeat.state==='ERROR')return{ok:false,status:'ERROR',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_ERROR']};
  if(heartbeat.state==='DEGRADED')return{ok:false,status:'DEGRADED',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_DEGRADED']};
  if(heartbeat.state==='BLOCKED')return{ok:false,status:'DEGRADED',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_BLOCKED']};
  if(heartbeat.state==='DISABLED')return{ok:false,status:'DEGRADED',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_DISABLED']};
  if(heartbeat.state!=='READY')return{ok:false,status:'ERROR',lastHeartbeat:heartbeat.checkedAt,reasonCodes:['AUTONOMOUS_RUNTIME_STATE_INVALID']};
  return{ok:true,status:'HEALTHY',lastHeartbeat:heartbeat.checkedAt,reasonCodes:[]};
}

function evaluateRuntimeJournal(value,kind,runtime){
  if(!runtime)return{ok:false,status:'ERROR',reasonCodes:[`${kind}_RUNTIME_DIAGNOSTIC_ERROR`]};
  if(runtime.status!=='HEALTHY')return{...runtime,reasonCodes:runtime.reasonCodes.map(code=>`${kind}_${code}`)};
  const safe=kind==='PAPER'?value.paperSafe:value.shadowSafe;
  const actual=kind==='PAPER'?value.paperCount:value.shadowCount;
  const reported=kind==='PAPER'?value.heartbeat.paperJournalEvents:value.heartbeat.shadowJournalEvents;
  const recoveryGap=kind==='PAPER'?value.paperRecoveryGap:value.shadowRecoveryGap;
  if(!safe)return{ok:false,status:'ERROR',lastHeartbeat:value.heartbeat.checkedAt,reasonCodes:[`${kind}_LIVE_ORDER_INVARIANT_BROKEN`]};
  if(actual<reported)return{ok:false,status:'ERROR',lastHeartbeat:value.heartbeat.checkedAt,reasonCodes:[`${kind}_JOURNAL_HEARTBEAT_MISMATCH`]};
  if(actual>reported)return{ok:false,status:'DEGRADED',lastHeartbeat:value.heartbeat.checkedAt,reasonCodes:[`${kind}_JOURNAL_HEARTBEAT_PENDING`]};
  if(recoveryGap)return{ok:false,status:'DEGRADED',lastHeartbeat:value.heartbeat.checkedAt,reasonCodes:[`${kind}_RECOVERY_GAP`]};
  return{ok:true,status:'HEALTHY',lastHeartbeat:value.heartbeat.checkedAt,reasonCodes:[]};
}

module.exports={evaluateAutonomousRuntimeHeartbeat,evaluateRuntimeJournal};
