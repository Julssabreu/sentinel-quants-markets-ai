export interface FreshnessAssessment { fresh:boolean; ageMinutes:number; clockSkewMinutes:number; reason:string }
export function assessTickFreshness(time:string|undefined|null,now=new Date(),maximumMinutes=30,maximumFutureMinutes=2/60):FreshnessAssessment{
  const timestamp=time?new Date(time).getTime():Number.NaN;
  if(!Number.isFinite(timestamp))return{fresh:false,ageMinutes:Infinity,clockSkewMinutes:Infinity,reason:"MT5 no entregó una hora válida para la cotización."};
  const rawAgeMinutes=(now.getTime()-timestamp)/60000;
  const clockSkewMinutes=Math.max(0,-rawAgeMinutes);
  const ageMinutes=Math.max(0,rawAgeMinutes);
  if(clockSkewMinutes>maximumFutureMinutes)return{fresh:false,ageMinutes,clockSkewMinutes,reason:`Cotización fechada ${clockSkewMinutes.toFixed(1)} min en el futuro; reloj del bróker no verificado.`};
  return{fresh:ageMinutes<=maximumMinutes,ageMinutes,clockSkewMinutes,reason:ageMinutes<=maximumMinutes?`Cotización actualizada hace ${ageMinutes.toFixed(1)} min.`:`Cotización atrasada ${ageMinutes.toFixed(0)} min; mercado posiblemente cerrado.`};
}
