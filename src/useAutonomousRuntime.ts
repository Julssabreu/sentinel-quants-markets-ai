import { useCallback, useEffect, useRef, useState } from 'react';
import { AutonomousRuntimeEngine, type AutonomousRuntimeReport } from './autonomousRuntime';
import { readRuntimeKillSwitch, RUNTIME_CONTROLS_EVENT } from './runtimeControls';

const STATUS_KEY='sentinel-autonomous-runtime-status-v1';

const initialReport:AutonomousRuntimeReport={state:'DISABLED',checkedAt:new Date(0).toISOString(),nextIntervalMinutes:2,symbols:[],paperJournalEvents:0,shadowJournalEvents:0,activePaper:0,activeShadow:0,deliveryRetries:null,reasonCodes:['RUNTIME_STARTING'],errors:[],liveOrderSent:false,executionAuthorized:false};

function publish(report:AutonomousRuntimeReport){
  try{localStorage.setItem(STATUS_KEY,JSON.stringify(report));}catch{}
  window.dispatchEvent(new CustomEvent('sentinel:autonomous-runtime-status',{detail:report}));
}

export function useAutonomousRuntime(){
  const[report,setReport]=useState<AutonomousRuntimeReport>(initialReport),running=useRef(false),engine=useRef<AutonomousRuntimeEngine|null>(null);
  if(!engine.current&&window.sentinel)engine.current=new AutonomousRuntimeEngine(window.sentinel,readRuntimeKillSwitch);

  const run=useCallback(async()=>{
    if(!engine.current||running.current)return null;
    running.current=true;
    try{
      const next=await engine.current.runConfiguredCycle();
      setReport(next);publish(next);return next;
    }
    finally{running.current=false;}
  },[]);

  useEffect(()=>{
    let stopped=false,timer:number|undefined;
    const tick=async()=>{const next=await run();if(stopped)return;const minutes=Math.max(1,next?.nextIntervalMinutes??2);timer=window.setTimeout(()=>void tick(),minutes*60_000);};
    const controlsChanged=()=>void run();
    window.addEventListener(RUNTIME_CONTROLS_EVENT,controlsChanged);
    void tick();
    return()=>{stopped=true;if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener(RUNTIME_CONTROLS_EVENT,controlsChanged);};
  },[run]);

  return{...report,running:running.current,run};
}
