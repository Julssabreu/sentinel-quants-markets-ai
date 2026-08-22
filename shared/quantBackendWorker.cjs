const path=require('path');
const {parentPort}=require('worker_threads');

if(!parentPort)throw new Error('quantBackendWorker requiere worker_threads.');
const backend=require(path.resolve(__dirname,'..','dist','quant-backend.cjs'));
parentPort.once('message',message=>{
  try{
    const operation=String(message?.operation||''),input=message?.input;
    const value=operation==='BACKTEST'?backend.runTrustedQuantBacktest(input):operation==='STAGE'?backend.runTrustedQuantStage(input):operation==='PARAMETER_STABILITY'?backend.runTrustedParameterStability(input):(()=>{throw new Error(`Operación backend Quant no soportada: ${operation}`)})();
    parentPort.postMessage({ok:true,value});
  }
  catch(error){parentPort.postMessage({ok:false,error:String(error?.stack||error?.message||error)})}
});
