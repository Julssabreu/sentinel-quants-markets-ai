function finite(value){return Number.isFinite(value)}
function close(a,b,tolerance=1e-9){return finite(a)&&finite(b)&&Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b))}
function assert(condition,message){if(!condition)throw new Error(`Persistencia Quant rechazada: ${message}`)}

function assertQuantSetup(payload){
  if(payload?.schemaVersion!==1)return;
  assert(typeof payload.setupId==='string'&&payload.setupId,'setupId ausente.');
  assert(typeof payload.experimentId==='string'&&payload.experimentId,'experimentId ausente.');
  assert(payload.auditId===`AUDIT:${payload.setupId}`,'auditId inconsistente.');
  assert(payload.quantStatusAtEntry==='RESEARCH','un backtest solo puede persistirse como RESEARCH.');
  assert(Array.isArray(payload.reasonCodes)&&payload.reasonCodes.includes('QUANT_RESEARCH_ONLY'),'falta marca RESEARCH_ONLY.');
  assert(payload.direction==='LONG'||payload.direction==='SHORT','dirección inválida.');
  assert(payload.features?.timestamp===payload.sourceTimestamp,'features fuera del timestamp causal.');
  assert(payload.features?.instrumentId===payload.instrumentId,'instrumento de features inconsistente.');
  assert(payload.features?.symbol===payload.symbol,'símbolo de features inconsistente.');
  assert(Object.keys(payload.datasetIds||{}).length>0,'datasetIds vacío.');
  const source=Date.parse(payload.sourceTimestamp),received=Date.parse(payload.receivedTimestamp),processed=Date.parse(payload.processingTimestamp);
  assert(finite(source)&&finite(received)&&finite(processed),'timestamps inválidos.');
  assert(received>=source&&processed>=received,'orden temporal de recepción/proceso inválido.');
  assert(finite(payload.riskPercent)&&payload.riskPercent>0&&payload.riskPercent<=5,'riskPercent fuera del contrato de laboratorio.');
  if(payload.resultStatus==='COMPLETED'){
    for(const field of ['entry','actualEntry','exit','stop','target','grossResultR','netResultR','grossResultPercent','netResultPercent'])assert(finite(payload[field]),`${field} no es finito.`);
    const entry=Date.parse(payload.entryTimestamp),exit=Date.parse(payload.exitTimestamp);
    assert(finite(entry)&&finite(exit)&&entry>=source&&exit>=entry,'intervalo ejecutado inválido.');
    assert(close(payload.grossResultPercent,payload.grossResultR*payload.riskPercent),'grossResultPercent no aplica riskPercent.');
    assert(close(payload.netResultPercent,payload.netResultR*payload.riskPercent),'netResultPercent no aplica riskPercent.');
  }else{
    assert(payload.resultStatus==='NOT_EXECUTED','resultStatus no soportado para backtest final.');
    for(const field of ['actualEntry','exit','entryTimestamp','exitTimestamp','grossResultR','netResultR','grossResultPercent','netResultPercent'])assert(payload[field]==null,`${field} debe ser null sin ejecución.`);
  }
}

function assertTradeMatchesSetup(trade,setup){
  for(const field of ['signalTimestamp','entryTimestamp','exitTimestamp','direction','stop','target','grossResultR','netResultR','maeR','mfeR']){
    const left=trade[field],right=field==='signalTimestamp'?setup.sourceTimestamp:field==='direction'?setup.direction:field==='stop'?setup.stop:field==='target'?setup.target:field==='grossResultR'?setup.grossResultR:field==='netResultR'?setup.netResultR:field==='maeR'?setup.maeR:field==='mfeR'?setup.mfeR:setup[field];
    assert(typeof left==='number'?close(left,right):left===right,`trade ${trade.setupId} difiere del setup en ${field}.`);
  }
  assert(close(trade.requestedEntry,setup.entry),'requestedEntry inconsistente.');
  assert(close(trade.entryFill,setup.actualEntry),'entryFill inconsistente.');
  assert(close(trade.exitFill,setup.exit),'exitFill inconsistente.');
  assert(close(trade.riskPercent,setup.riskPercent),'riskPercent de trade inconsistente.');
}

function assertBacktestResult(payload,setupEntries,experimentEntries,datasetEntries){
  if(!String(payload?.resultId||'').startsWith('BACKTEST:'))return;
  const experimentId=String(payload.experimentId||''),datasetId=String(payload.datasetId||'');
  assert(payload.resultId===`BACKTEST:${experimentId}`,'resultId de backtest inconsistente.');
  const experiment=experimentEntries.find(entry=>entry.id===experimentId)?.payload;
  assert(experiment&&experiment.datasetId===datasetId,'experimento/dataset no registrados.');
  const dataset=datasetEntries.find(entry=>entry.id===datasetId)?.payload;
  assert(dataset&&dataset.checksum===payload.datasetChecksum,'checksum durable del dataset no coincide.');
  assert(payload.computationAuthority==='SENTINEL_BACKEND_V1','el resultado no fue calculado por el backend confiable.');
  assert(payload.status==='COMPLETED','estado de backtest inválido.');
  const result=payload.result;
  assert(result?.experimentId===experimentId,'resultado pertenece a otro experimento.');
  assert(Array.isArray(result.trades)&&Array.isArray(result.candidates),'trades/candidates ausentes.');
  const setups=setupEntries.map(entry=>entry.payload).filter(setup=>setup.experimentId===experimentId),byId=new Map(setups.map(setup=>[setup.setupId,setup]));
  assert(setups.length===result.candidates.length,'cantidad de candidatos no coincide con setups persistidos.');
  assert(new Set(result.candidates.map(item=>item.setupId)).size===result.candidates.length,'candidatos duplicados.');
  for(const candidate of result.candidates){const setup=byId.get(candidate.setupId);assert(setup,'candidato sin setup persistido.');assert(candidate.signalTimestamp===setup.sourceTimestamp,'timestamp de candidato inconsistente.');}
  const completed=setups.filter(setup=>setup.resultStatus==='COMPLETED');
  assert(completed.length===result.trades.length,'cantidad de trades no coincide con setups completados.');
  for(const trade of result.trades){const setup=byId.get(trade.setupId);assert(setup?.resultStatus==='COMPLETED','trade sin setup completado.');assertTradeMatchesSetup(trade,setup);}
  const net=result.trades.reduce((sum,trade)=>sum+trade.netResultR,0),gross=result.trades.reduce((sum,trade)=>sum+trade.grossResultR,0),risk=Number(experiment.config?.risk?.riskPercent??result.riskPercent);
  assert(close(result.netR,net)&&close(result.grossR,gross),'agregados R no coinciden con trades.');
  assert(close(result.riskPercent,risk),'riskPercent no coincide con el experimento.');
  assert(result.riskModel==='FIXED_FRACTION_NON_COMPOUNDED','modelo de riesgo no declarado o incompatible.');
  assert(close(result.netReturnPercent,net*risk)&&close(result.grossReturnPercent,gross*risk),'retorno porcentual no aplica el riesgo declarado.');
  assert(payload.statistics?.sampleSize===result.trades.length,'sampleSize no coincide con trades.');
  assert(Array.isArray(payload.statistics?.returns)&&payload.statistics.returns.length===result.trades.length,'returns estadísticos inconsistentes.');
  result.trades.forEach((trade,index)=>assert(close(payload.statistics.returns[index],trade.netResultR),`return estadístico ${index} inconsistente.`));
}

const TRUSTED_DERIVED_STAGES=new Set(['OUT_OF_SAMPLE','WALK_FORWARD','MONTE_CARLO','BENCHMARK','ROBUSTNESS','ABLATION_PLAN','ABLATION_RUN','ABLATION_VALIDATION','QUANT_GATE','PARAMETER_STABILITY']);
function assertTrustedDerivedResult(payload,experimentEntries,datasetEntries){
  const stage=String(payload?.stage||'');
  if(!TRUSTED_DERIVED_STAGES.has(stage))return;
  const experimentId=String(payload.experimentId||''),datasetId=String(payload.datasetId||''),experiment=experimentEntries.find(entry=>entry.id===experimentId)?.payload,dataset=datasetEntries.find(entry=>entry.id===datasetId)?.payload;
  assert(experiment&&experiment.datasetId===datasetId,'etapa derivada no coincide con experimento/dataset durable.');
  assert(dataset&&dataset.checksum===payload.datasetChecksum,'checksum de etapa derivada no coincide.');
  assert(payload.computationAuthority==='SENTINEL_BACKEND_V1','etapa derivada no fue calculada por backend confiable.');
  assert(payload.output&&typeof payload.output==='object','etapa derivada sin output estructurado.');
  assert(payload.output.executionAuthorized!==true&&payload.output.tradeAuthorized!==true,'etapa derivada intentó autorizar ejecución.');
  if(stage==='WALK_FORWARD')assert(false,'walk-forward bloqueado hasta disponer de reentrenamiento y prueba causal por fold.');
  if(stage==='PARAMETER_STABILITY')assert(payload.output.oosAccessed===false,'estabilidad paramétrica accedió OOS.');
}

module.exports={assertQuantSetup,assertBacktestResult,assertTrustedDerivedResult};
