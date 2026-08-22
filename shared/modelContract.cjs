const MODEL_MANIFEST=require('./modelManifest.json');

function fingerprint(value){
  const serialized=JSON.stringify(value);
  let hash=2166136261;
  for(let index=0;index<serialized.length;index+=1){
    hash^=serialized.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return `FNV1A-${(hash>>>0).toString(16).padStart(8,'0')}`;
}

const MODEL_FINGERPRINT=fingerprint(MODEL_MANIFEST);

function simulationFingerprint(record){
  return fingerprint({
    model:MODEL_FINGERPRINT,
    symbol:record.brokerSymbol||record.symbol,
    timeframe:record.timeframe,
    anchor:record.simulationAnchorTime,
    direction:record.plan?.direction,
    trigger:record.plan?.trigger,
    maxEntry:record.plan?.maxEntry,
    stop:record.plan?.stop,
    tp1:record.plan?.tp1,
    tp2:record.plan?.tp2,
    expiresAfterBars:record.plan?.expiresAfterBars,
    strategy:record.strategy,
  });
}

module.exports={MODEL_MANIFEST,MODEL_FINGERPRINT,fingerprint,simulationFingerprint};
