import {describe,expect,it} from 'vitest';
// @ts-expect-error CommonJS shared production module
import guard from '../shared/backendGuard.cjs';
// @ts-expect-error CommonJS shared production module
import contract from '../shared/modelContract.cjs';

const anchor=new Date(Date.now()-60*60_000).toISOString();

function draft(overrides:Record<string,unknown>={}){
  const base={
    symbol:'AAPL',brokerSymbol:'AAPL.US',timeframe:'H1',
    decision:'BUY_CONDICIONADO',analyticalDecision:'BUY_CONDICIONADO',
    confidence:68,analyticalConfidence:68,
    maturityStatus:'RESEARCH',maturitySample:0,
    recommendationStatus:'RESEARCH_ONLY',recommendationAuthorized:false,
    executionStatus:'DISABLED',executionAuthorized:false,
    simulationEligible:true,planMode:'SIMULATION',simulationAnchorTime:anchor,
    strategy:'BREAKOUT_STRUCTURE_ATR',
    modelId:contract.MODEL_MANIFEST.modelId,
    modelVersion:contract.MODEL_MANIFEST.version,
    modelFingerprint:contract.MODEL_FINGERPRINT,
    analysisFingerprint:contract.fingerprint({kind:'ANALYSIS',brokerSymbol:'AAPL.US',timeframe:'H1',anchor}),
    plan:{direction:'BUY',trigger:100,maxEntry:101,stop:98,tp1:103,tp2:105,expiresAfterBars:3,mode:'SIMULATED'},
    sources:['MT5'],outcome:null,
    ...overrides,
  };
  return {...base,simulationFingerprint:contract.simulationFingerprint(base)};
}

function resolved(index:number,status:'TP2'|'STOP'='TP2'){
  const base=draft({
    id:`resolved-${index}`,
    schemaVersion:3,
    createdAt:new Date(Date.parse(anchor)-index*60_000).toISOString(),
    simulationAnchorTime:new Date(Date.parse(anchor)-index*3_600_000).toISOString(),
    outcome:{status},
  });
  return {...base,simulationFingerprint:contract.simulationFingerprint(base)};
}

describe('backend history guard',()=>{
  it('recalcula madurez y acepta un plan actual reproducible',()=>{
    const saved=guard.prepareHistoryDraft(draft({maturityStatus:'ACTIVE',maturitySample:30}),[]);
    expect(saved.maturityStatus).toBe('RESEARCH');
    expect(saved.maturitySample).toBe(0);
    expect(saved.executionAuthorized).toBe(false);
  });

  it('rechaza niveles imposibles y fingerprints manipulados',()=>{
    const invalidLevels=draft({plan:{direction:'BUY',trigger:100,maxEntry:101,stop:102,tp1:103,tp2:105,expiresAfterBars:3,mode:'SIMULATED'}});
    expect(()=>guard.prepareHistoryDraft(invalidLevels,[])).toThrow(/niveles/i);
    expect(()=>guard.prepareHistoryDraft({...draft(),simulationFingerprint:'FNV1A-00000000'},[])).toThrow(/fingerprint/i);
    expect(()=>guard.prepareHistoryDraft({...draft(),analysisFingerprint:'not-stable'},[])).toThrow(/fingerprint/i);
  });

  it('no permite declarar recomendación durante RESEARCH',()=>{
    expect(()=>guard.prepareHistoryDraft(draft({recommendationAuthorized:true,recommendationStatus:'MANUAL_REVIEW'}),[])).toThrow(/gobernanza/i);
  });

  it('solo confía una revisión ligada a evidencia y gobernanza suficientes',()=>{
    const evidence=Array.from({length:30},(_,index)=>resolved(index));
    const active=guard.deriveModelGovernance(evidence);
    expect(active.status).toBe('ACTIVE');
    const candidate=draft({
      id:'candidate',schemaVersion:3,createdAt:new Date().toISOString(),
      maturityStatus:active.status,maturitySample:active.sample,
      recommendationAuthorized:true,recommendationStatus:'MANUAL_REVIEW',
    });
    const records=[candidate,...evidence];
    expect(guard.trustedReviewRecord({analysisRecordId:'candidate',symbol:'AAPL',timeframe:'H1'},records)).not.toBeNull();
    expect(guard.trustedReviewRecord({analysisRecordId:'candidate',symbol:'MSFT',timeframe:'H1'},records)).toBeNull();
    expect(guard.trustedReviewRecord({analysisRecordId:'missing',symbol:'AAPL',timeframe:'H1'},records)).toBeNull();
  });
});
