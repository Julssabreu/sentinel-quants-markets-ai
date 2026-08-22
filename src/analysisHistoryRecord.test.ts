import {describe,expect,it} from 'vitest';
import {buildAnalysisHistoryDraft} from './analysisHistoryRecord';
import {NO_VIX_DECISION_CONTEXT,type DecisionResult} from './decisionEngine';
import type {MultiTimeframeAnalysis} from './multiTimeframeAnalysis';
import type {TradePlan} from './tradePlan';
import type {DecisionPosture} from './decisionPosture';

const decision:DecisionResult={decision:'BUY_CONDICIONADO',confidence:68,technicalConfidence:72,eventAction:'NORMAL',reasons:[],volatilityContext:NO_VIX_DECISION_CONTEXT};
const technical:MultiTimeframeAnalysis={score:20,confidence:72,alignment:70,bias:'ALCISTA',available:21,bullish:[],bearish:[],neutral:[],contradictions:[],results:[]};
const plan:TradePlan={active:true,direction:'BUY',trigger:100,maxEntry:101,stop:98,tp1:103,tp2:105,riskReward1:1.5,riskReward2:2.5,atr:2,expiresAfterBars:3,cancellation:[]};
const posture:DecisionPosture={analyticalLabel:'SESGO BUY',analyticalDecision:'BUY_CONDICIONADO',analyticalConfidence:68,maturityStatus:'RESEARCH',maturitySample:0,recommendationStatus:'RESEARCH_ONLY',recommendationAuthorized:false,executionStatus:'DISABLED',executionAuthorized:false,simulationEligible:true,reasons:['Investigación.'],summary:'Sesgo BUY.'};

describe('analysis history draft',()=>{
  it('guarda una simulación reproducible sin autorizar ejecución',()=>{
    const record=buildAnalysisHistoryDraft({symbol:'AAPL',brokerSymbol:'AAPL.US',timeframe:'H1',anchorTime:'2026-08-10T14:00:00Z',decision,technical:{...technical,bullish:[],bearish:[],neutral:[],results:[]},plan,posture,quality:{score:100,warnings:[]},sources:['MT5','MT5']});
    expect(record.simulationFingerprint).toMatch(/^FNV1A-/);
    expect(record.plan?.mode).toBe('SIMULATED');
    expect(record.recommendationAuthorized).toBe(false);
    expect(record.executionAuthorized).toBe(false);
    expect(record.sources).toEqual(['MT5']);
  });

  it('elimina niveles si la simulación no es elegible',()=>{
    const record=buildAnalysisHistoryDraft({symbol:'AAPL',brokerSymbol:'AAPL.US',timeframe:'H1',anchorTime:'2026-08-10T14:00:00Z',decision,technical:{...technical,bullish:[],bearish:[],neutral:[],results:[]},plan,posture:{...posture,simulationEligible:false},quality:{score:40,warnings:['Datos incompletos.']},sources:['MT5']});
    expect(record.plan).toBeNull();
    expect(record.simulationFingerprint).toBeUndefined();
  });
});
