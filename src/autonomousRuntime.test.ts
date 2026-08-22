import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENTINEL_QUANT_VERSIONS } from './sentinelQuantVersions';

vi.mock('./smcStrategy',async importOriginal=>{
  const actual=await importOriginal<typeof import('./smcStrategy')>();
  return{...actual,analyzeSmcStrategy:vi.fn(()=>({
    strategyId:actual.SMC_STRATEGY_ID,direction:'BUY',stage:'READY',score:100,
    steps:[
      {timeframe:'D1',role:'bias',confirmed:true,summary:'D1 ready'},
      {timeframe:'H4',role:'zone',confirmed:true,summary:'H4 ready'},
      {timeframe:'H1',role:'setup',confirmed:true,summary:'H1 ready'},
      {timeframe:'M15',role:'refine',confirmed:true,summary:'M15 ready'},
      {timeframe:'M5',role:'trigger',confirmed:true,summary:'M5 ready'},
    ],entry:1.1,stop:1.09,target:1.12,riskReward:2,reasons:['SMC_READY'],warnings:[],facts:null,
    strategyVersion:SENTINEL_QUANT_VERSIONS.smcStrategy,profileId:'TEST',
  }))};
});

import { AutonomousRuntimeEngine, configuredWatchlistSymbols, type AutonomousRuntimeApi } from './autonomousRuntime';
import { initialKillSwitchState } from './killSwitch';
import { reconstructPaperObservations } from './paperTradingCoordinator';
import { reconstructShadowObservations } from './shadowCoordinator';

const NOW=new Date('2026-08-17T12:00:00.000Z');
const candles=(count=100):Mt5Candle[]=>Array.from({length:count},(_,index)=>{
  const close=1+index*.001;
  return{time:new Date(NOW.getTime()-(count-index)*300_000).toISOString(),open:close-.0005,high:close+.001,low:close-.001,close,tickVolume:100,spread:1,realVolume:0};
});

function api(options:{recoveryPageLimit?:number}={}){
  let runtimeNow=NOW;
  const currentNow=()=>runtimeNow;
  const series=candles(),paperEvents:import('./paperTradingEngine').PaperEvent[]=[],shadowEvents:import('./shadowMode').ShadowEvent[]=[];
  const frame=(timeframe:string,rows:Mt5Candle[]=series):Mt5RatesResponse=>({ok:true,requested:'EUR/USD',symbol:'EURUSD.m',canonical:'EUR/USD',timeframe,candles:rows,source:'MT5 · JustMarkets',permissions:'read-only',liveOrderSent:false,executionAuthorized:false,tick:{bid:1.0999,ask:1.1001,last:1.1,time:currentNow().toISOString()},clock:{status:'BROKER_CLOCK_CORRECTED',offsetSeconds:10800,sampleCount:3,measuredAt:currentNow().toISOString()}});
  const value={
    getWatchlists:vi.fn(async()=>({ok:true,config:{schemaVersion:1 as const,activeListId:'AUTO',intervalMinutes:2,lists:[{id:'AUTO',name:'Auto',enabled:true,symbols:['EUR/USD']}]}})),
    getSignalNotifier:vi.fn(async()=>({ok:true,config:{schemaVersion:3 as const,enabled:true,channel:'whatsapp' as const,target:'+10000000000',timeframes:['M5'],intervalMinutes:2,minConfidence:45,riskPercent:.5,maxSymbols:10,keepInTray:true,startWithWindows:true}})),
    getMt5MultiRates:vi.fn(async(_symbol:string,_timeframes:string[],count=350)=>({ok:true,requested:'EUR/USD',requestedTimeframes:['D1','H4','H1','M15','M5'],availableTimeframes:['D1','H4','H1','M15','M5'],results:Object.fromEntries(['D1','H4','H1','M15','M5'].map(tf=>[tf,frame(tf,series.slice(-count))])),source:'MT5',clock:{status:'BROKER_CLOCK_CORRECTED' as const,offsetSeconds:10800,sampleCount:3,measuredAt:currentNow().toISOString()}})),
    getMt5RatesAfter:vi.fn(async(_symbol:string,_timeframe:string,after:string,count=5000,until=currentNow().toISOString())=>{const rows=series.filter(bar=>Date.parse(bar.time)>Date.parse(after)&&Date.parse(bar.time)+300_000<=Date.parse(until)),limit=Math.min(count,options.recoveryPageLimit??count),page=rows.slice(0,limit);return{...frame('M5',page),after,queryUntil:until,hasMore:rows.length>page.length,pageLimit:limit,permissions:'read-only' as const,liveOrderSent:false as const,executionAuthorized:false as const}}),
    getMt5Microstructure:vi.fn(async()=>({ok:false} as Mt5MicrostructureResponse)),
    getMacroSnapshot:vi.fn(async()=>({checkedAt:NOW.toISOString(),indicators:[],events:[],yieldCurve:null,errors:[]})),
    getNewsSnapshot:vi.fn(async()=>({checkedAt:NOW.toISOString(),articles:[],errors:[],sources:[]})),
    getMt5Portfolio:vi.fn(async()=>({ok:true,account:{currency:'USD',balance:10_000,equity:10_000,margin:0,marginFree:10_000,marginLevel:0,profit:0,leverage:100},positions:[],checkedAt:NOW.toISOString(),permissions:'READ_ONLY'})),
    listAnalysisHistory:vi.fn(async()=>({ok:true,records:[]})),
    getMt5Factors:vi.fn(async()=>({ok:false,factors:[],errors:[],checkedAt:NOW.toISOString(),permissions:'READ_ONLY'})),
    getInstitutionalFactors:vi.fn(async()=>({checkedAt:NOW.toISOString(),realYields:null,cot:[],cryptoDerivatives:null,errors:[],permissions:'READ_ONLY'})),
    getTradingViewVixContext:vi.fn(async()=>({ok:false,status:'DISABLED' as const,contextType:'MARKET_CONTEXT' as const,symbol:'VIX' as const,operationalSignal:false as const,snapshot:null,history:[],checkedAt:NOW.toISOString(),fetchedAt:null,error:null})),
    getTradingViewConfig:vi.fn(async()=>({ok:true,config:{schemaVersion:1 as const,enabled:true,endpoint:'https://example.test',pollSeconds:10,maxAgeMinutes:30,hasToken:true}})),
    getTradingViewMarketObservations:vi.fn(async()=>({ok:true,status:'READY' as const,contextType:'MARKET_OBSERVATION' as const,operationalSignal:false as const,symbol:'EUR/USD',timeframe:'M5',observations:[{id:'TV1',source:'TRADINGVIEW' as const,contextType:'MARKET_OBSERVATION' as const,operationalSignal:false as const,rawSymbol:'EURUSD',exchange:'OANDA',marketType:'FOREX',timeframe:'M5',observedAt:NOW.toISOString(),open:1.099,high:1.101,low:1.098,close:series.at(-1)!.close,volume:1,currency:'USD',baseCurrency:'EUR',receivedAt:NOW.toISOString(),metadata:null,updatedAt:NOW.toISOString()}],checkedAt:NOW.toISOString(),error:null})),
    getLatestOperationalHealth:vi.fn(async()=>({ok:true,snapshot:{schemaVersion:1 as const,operationalEventId:'HEALTH:1',timestamp:currentNow().toISOString(),overall:'HEALTHY' as const,blockNewOpportunities:false,reasonCodes:[],liveEnabled:false as const,liveOrderSent:false as const,executionAuthorized:false as const,components:[{id:'MT5',status:'HEALTHY' as const,lastMessage:currentNow().toISOString(),lastHeartbeat:currentNow().toISOString(),latencyMs:10,critical:true,reasonCodes:[],configured:true,checkedAt:currentNow().toISOString(),source:'LIVE_PROBE' as const}]}})),
    refreshOperationalHealth:vi.fn(),
    saveAnalysisHistory:vi.fn(async(record:any)=>({ok:true,record:{...record,id:'ANALYSIS-1',createdAt:NOW.toISOString(),schemaVersion:3}})),
    listPaperEvents:vi.fn(async()=>({ok:true,events:paperEvents})),
    appendPaperEvents:vi.fn(async(events:typeof paperEvents)=>{paperEvents.push(...events);return{ok:true,created:events.length,duplicates:0,activePaperIds:events.map(item=>item.paperId)}}),
    listShadowEvents:vi.fn(async()=>({ok:true,events:shadowEvents})),
    appendShadowEvents:vi.fn(async(events:typeof shadowEvents)=>{shadowEvents.push(...events);return{ok:true,created:events.length,duplicates:0,activeShadowIds:events.map(item=>item.shadowId)}}),
    saveAutonomousRuntimeHeartbeat:vi.fn(async(heartbeat:import('./autonomousRuntime').AutonomousRuntimeReport)=>({ok:true,heartbeat:{...structuredClone(heartbeat),schemaVersion:1 as const,persistedAt:currentNow().toISOString()}})),
    retryPendingSignalDeliveries:vi.fn(async()=>({ok:true,status:'COMPLETED',retried:2,sent:1,pending:1})),
  };
  return{value:value as unknown as AutonomousRuntimeApi,series,paperEvents,shadowEvents,appendPaper:value.appendPaperEvents,appendShadow:value.appendShadowEvents,saveHeartbeat:value.saveAutonomousRuntimeHeartbeat,setNow:(next:Date)=>{runtimeNow=next}};
}

describe('autonomous runtime integration',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('respeta exactamente listas habilitadas sin símbolos implícitos',()=>{
    expect(configuredWatchlistSymbols({schemaVersion:1,activeListId:'A',intervalMinutes:2,lists:[{id:'A',name:'A',enabled:false,symbols:['BTC/USD']},{id:'B',name:'B',enabled:true,symbols:['EUR/USD','EUR/USD']}]})).toEqual(['EUR/USD']);
  });
  it('conecta watchlist, SMC, historial, Paper y Shadow y deduplica por setup estable',async()=>{
    const mocked=api(),engine=new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>NOW);
    const first=await engine.runConfiguredCycle();
    expect(first).toMatchObject({state:'READY',activePaper:1,activeShadow:1,deliveryRetries:{attempted:2,sent:1,pending:1},liveOrderSent:false,executionAuthorized:false});
    expect(first.symbols[0]).toMatchObject({symbol:'EUR/USD',state:'SETUP_CREATED',smcStage:'READY',paperEventsCreated:1,shadowEventsCreated:1,error:null});
    expect(mocked.paperEvents[0].observation).toMatchObject({status:'PENDING_ENTRY',liveOrderSent:false,reasonCodes:['PAPER_RESEARCH_EVIDENCE_ONLY','NO_LIVE_ORDER']});
    expect(mocked.shadowEvents[0].observation).toMatchObject({status:'PENDING_ENTRY',liveOrderSent:false,reasonCodes:['SHADOW_RESEARCH_EVIDENCE_ONLY','NO_LIVE_ORDER']});
    await engine.runConfiguredCycle();
    expect(mocked.appendPaper).toHaveBeenCalledTimes(1);
    expect(mocked.appendShadow).toHaveBeenCalledTimes(1);
    expect(mocked.saveHeartbeat).toHaveBeenCalledTimes(2);
    expect(mocked.saveHeartbeat.mock.calls.every(([heartbeat])=>heartbeat.liveOrderSent===false&&heartbeat.executionAuthorized===false)).toBe(true);
  });
  it('bloquea nuevas observaciones cuando el Kill Switch está activo',async()=>{
    const mocked=api(),kill={...initialKillSwitchState(),engaged:true,engagedAt:NOW.toISOString(),engagedBy:'USER',reason:'TEST',mode:'LIVE_DISABLED' as const};
    const report=await new AutonomousRuntimeEngine(mocked.value,()=>kill,()=>NOW).runConfiguredCycle();
    expect(report.state).toBe('BLOCKED');
    expect(report.symbols[0]).toMatchObject({state:'BLOCKED',reasonCodes:expect.arrayContaining(['KILL_SWITCH_ENGAGED'])});
    expect(mocked.paperEvents[0].observation.status).toBe('BLOCKED');
    expect(mocked.shadowEvents[0].observation.status).toBe('BLOCKED');
  });
  it('avanza observaciones recuperables solo con la siguiente vela y persiste el resultado',async()=>{
    const mocked=api(),engine=new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>NOW);
    await engine.runConfiguredCycle();
    mocked.series.push({time:NOW.toISOString(),open:1.1,high:1.121,low:1.099,close:1.12,tickVolume:120,spread:1,realVolume:0});
    const afterClose=new Date(NOW.getTime()+300_000);mocked.setNow(afterClose);
    await new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>afterClose).runConfiguredCycle();
    expect(mocked.paperEvents.some(event=>event.eventType==='BAR_PROCESSED'&&event.observation.status==='CLOSED'&&event.observation.netResultR!=null)).toBe(true);
    expect(mocked.shadowEvents.some(event=>event.eventType==='RESOLVED'&&event.observation.status==='CLOSED'&&event.observation.theoreticalResultR!=null)).toBe(true);
    expect(mocked.paperEvents.every(event=>event.observation.liveOrderSent===false)).toBe(true);
    expect(mocked.shadowEvents.every(event=>event.observation.liveOrderSent===false)).toBe(true);
  });
  it('recupera tras reinicio mas de 350 velas paginadas sin omitir un stop temprano',async()=>{
    const mocked=api({recoveryPageLimit:137});
    await new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>NOW).runConfiguredCycle();
    const paperId=mocked.paperEvents[0].paperId,shadowId=mocked.shadowEvents[0].shadowId;
    const recovered=Array.from({length:401},(_,index):Mt5Candle=>{
      const time=new Date(NOW.getTime()+index*300_000).toISOString(),stop=index===1;
      return{time,open:1.1,high:1.105,low:stop?1.08:1.095,close:1.1,tickVolume:100,spread:1,realVolume:0};
    });
    mocked.series.push(...recovered);
    const resumedAt=new Date(Date.parse(recovered.at(-1)!.time)+300_000);mocked.setNow(resumedAt);
    const report=await new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>resumedAt).runConfiguredCycle();
    const paper=reconstructPaperObservations(mocked.paperEvents).find(item=>item.paperId===paperId);
    const shadow=reconstructShadowObservations(mocked.shadowEvents).find(item=>item.shadowId===shadowId);
    expect(paper).toMatchObject({status:'CLOSED',exitReason:'STOP',closedAt:recovered[1].time,liveOrderSent:false});
    expect(shadow).toMatchObject({status:'CLOSED',exitReason:'STOP',closedAt:recovered[1].time,liveOrderSent:false});
    expect(mocked.value.getMt5MultiRates).toHaveBeenLastCalledWith('EUR/USD',['D1','H4','H1','M15','M5'],350);
    expect(mocked.value.getMt5RatesAfter).toHaveBeenCalledTimes(3);
    expect(report).toMatchObject({state:'READY',liveOrderSent:false,executionAuthorized:false});
  });
  it('persiste Paper y Shadow BLOCKED sin performance cuando falta una M5',async()=>{
    const mocked=api({recoveryPageLimit:7});
    await new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>NOW).runConfiguredCycle();
    const paperId=mocked.paperEvents[0].paperId,shadowId=mocked.shadowEvents[0].shadowId;
    const recovered=Array.from({length:20},(_,index):Mt5Candle=>({time:new Date(NOW.getTime()+index*300_000).toISOString(),open:1.1,high:1.105,low:1.095,close:1.1,tickVolume:100,spread:1,realVolume:0})).filter((_,index)=>index!==8);
    mocked.series.push(...recovered);
    const resumedAt=new Date(Date.parse(recovered.at(-1)!.time)+300_000);mocked.setNow(resumedAt);
    const report=await new AutonomousRuntimeEngine(mocked.value,initialKillSwitchState,()=>resumedAt).runConfiguredCycle();
    const paper=reconstructPaperObservations(mocked.paperEvents).find(item=>item.paperId===paperId);
    const shadow=reconstructShadowObservations(mocked.shadowEvents).find(item=>item.shadowId===shadowId);
    expect(report).toMatchObject({state:'BLOCKED',reasonCodes:expect.arrayContaining(['RECOVERY_GAP','RECOVERY_GAP_NO_PERFORMANCE']),liveOrderSent:false,executionAuthorized:false});
    expect(paper).toMatchObject({status:'BLOCKED',plan:null,enteredAt:null,closedAt:null,grossResultR:null,netResultR:null,maeR:null,mfeR:null,reasonCodes:expect.arrayContaining(['RECOVERY_GAP','RECOVERY_GAP_NO_PERFORMANCE']),liveOrderSent:false});
    expect(shadow).toMatchObject({status:'BLOCKED',plan:null,enteredAt:null,closedAt:null,theoreticalResultR:null,grossResultR:null,maeR:null,mfeR:null,reasonCodes:expect.arrayContaining(['RECOVERY_GAP','RECOVERY_GAP_NO_PERFORMANCE']),liveOrderSent:false});
    expect(mocked.paperEvents.some(event=>event.eventType==='RECOVERY_BLOCKED')).toBe(true);
    expect(mocked.shadowEvents.some(event=>event.eventType==='RECOVERY_BLOCKED')).toBe(true);
  });
  it('persiste tambien el heartbeat de un ciclo fallido y degrada si no puede guardarlo',async()=>{
    const failed=api();vi.mocked(failed.value.getWatchlists).mockRejectedValueOnce(new Error('WATCHLIST_DOWN'));
    const errorReport=await new AutonomousRuntimeEngine(failed.value,initialKillSwitchState,()=>NOW).runConfiguredCycle();
    expect(errorReport.state).toBe('ERROR');
    expect(failed.saveHeartbeat).toHaveBeenCalledWith(expect.objectContaining({state:'ERROR',liveOrderSent:false,executionAuthorized:false}));
    const unavailable=api();unavailable.saveHeartbeat.mockRejectedValueOnce(new Error('DISK_DOWN'));
    const degraded=await new AutonomousRuntimeEngine(unavailable.value,initialKillSwitchState,()=>NOW).runConfiguredCycle();
    expect(degraded).toMatchObject({state:'DEGRADED',reasonCodes:expect.arrayContaining(['AUTONOMOUS_HEARTBEAT_PERSIST_FAILED']),liveOrderSent:false,executionAuthorized:false});
  });
});
