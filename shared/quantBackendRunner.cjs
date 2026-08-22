const path=require('path');
const {Worker}=require('worker_threads');

let loaded=null;
function loadBackendBundle(){
  if(loaded)return loaded;
  const bundlePath=path.resolve(__dirname,'..','dist','quant-backend.cjs');
  try{loaded=require(bundlePath)}catch(error){
    const detail=error&&error.code==='MODULE_NOT_FOUND'?'Falta dist/quant-backend.cjs; ejecute el build backend antes de iniciar Sentinel.':String(error?.message||error);
    throw new Error(`Backend Quant confiable no disponible. ${detail}`);
  }
  if(typeof loaded?.runTrustedQuantBacktest!=='function')throw new Error('El bundle backend Quant no expone runTrustedQuantBacktest.');
  return loaded;
}

function runWorker(operation,input){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.resolve(__dirname,'quantBackendWorker.cjs'));
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;void worker.terminate();error?reject(error):resolve(value)};
    worker.once('message',message=>message?.ok?finish(null,message.value):finish(new Error(message?.error||'El worker Quant falló sin detalle.')));
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(code!==0)finish(new Error(`El worker Quant terminó con código ${code}.`))});
    worker.postMessage({operation,input});
  });
}
function runTrustedQuantBacktest(input){return runWorker('BACKTEST',input)}
function runTrustedQuantStage(input){return runWorker('STAGE',input)}
function runTrustedParameterStability(input){return runWorker('PARAMETER_STABILITY',input)}
function validateTrustedQuantPreparation(input){return loadBackendBundle().validateTrustedQuantPreparation(input)}
function getTrustedQuantBackendStatus(){
  try{loadBackendBundle();return{ok:true,authority:'SENTINEL_BACKEND_V1'}}
  catch(error){return{ok:false,authority:null,error:String(error?.message||error)}}
}

module.exports={runTrustedQuantBacktest,runTrustedQuantStage,runTrustedParameterStability,validateTrustedQuantPreparation,getTrustedQuantBackendStatus};
