export interface PositionSizeInput { balance:number; riskPercent:number; entry:number; stop:number; specification:NonNullable<Mt5RatesResponse['specification']> }
export interface PositionSizeResult { valid:boolean; riskAmount:number; rawVolume:number; volume:number; estimatedLoss:number; lossPerLot:number; warning:string|null }
const floorStep=(value:number,step:number)=>Math.floor((value+1e-12)/step)*step;
const decimals=(step:number)=>Math.max(0,(String(step).split('.')[1]||'').length);
export function calculatePositionSize(input:PositionSizeInput):PositionSizeResult {
 const {balance,riskPercent,entry,stop,specification:s}=input,riskAmount=balance*riskPercent/100,distance=Math.abs(entry-stop);
 const tickValue=s.tickValueLoss||s.tickValue||s.tickValueProfit;
 if(![balance,riskPercent,entry,stop,s.tickSize,tickValue,s.volumeStep].every(x=>Number.isFinite(x)&&x>0)||distance===0)return{valid:false,riskAmount:Math.max(0,riskAmount),rawVolume:0,volume:0,estimatedLoss:0,lossPerLot:0,warning:'Especificaciones o niveles inválidos.'};
 const lossPerLot=distance/s.tickSize*tickValue,rawVolume=riskAmount/lossPerLot;
 if(rawVolume<s.volumeMin)return{valid:false,riskAmount,rawVolume,volume:0,estimatedLoss:0,lossPerLot,warning:`El lote mínimo ${s.volumeMin} excedería el riesgo permitido.`};
 const volume=Number(Math.min(s.volumeMax,floorStep(rawVolume,s.volumeStep)).toFixed(decimals(s.volumeStep))),estimatedLoss=volume*lossPerLot;
 return{valid:volume>=s.volumeMin,riskAmount,rawVolume,volume,estimatedLoss,lossPerLot,warning:volume>=s.volumeMin?null:'No existe un volumen válido para este contrato.'};
}
