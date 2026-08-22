import { engageKillSwitch, initialKillSwitchState, releaseKillSwitch, type KillSwitchState } from './killSwitch';

const STORAGE_KEY='sentinel-runtime-kill-switch-v1';
const EVENT_NAME='sentinel:runtime-controls';

function valid(value:unknown):value is KillSwitchState {
  const state=value as Partial<KillSwitchState> | null;
  return Boolean(state&&typeof state.engaged==='boolean'&&state.analysisEnabled===true&&typeof state.blockNewOrders==='boolean');
}

export function readRuntimeKillSwitch():KillSwitchState {
  try{const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)??'null');if(valid(parsed))return parsed;}catch{}
  return initialKillSwitchState();
}

function persist(state:KillSwitchState){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT_NAME,{detail:state}));
  return state;
}

export function engageRuntimeKillSwitch(reason='MANUAL_EMERGENCY_STOP',actor='USER') {
  return persist(engageKillSwitch(readRuntimeKillSwitch(),{timestamp:new Date().toISOString(),actor,reason}));
}

export function releaseRuntimeKillSwitch(reason='MANUAL_VERIFIED_RELEASE',actor='USER') {
  return persist(releaseKillSwitch(readRuntimeKillSwitch(),{timestamp:new Date().toISOString(),actor,reason}));
}

export const RUNTIME_CONTROLS_EVENT=EVENT_NAME;
