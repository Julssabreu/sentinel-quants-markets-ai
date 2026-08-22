export type ImpactDirection='FAVORECE'|'PRESIONA'|'MIXTO';
export interface AssetImpact { asset:string; direction:ImpactDirection; confidence:number; reason:string }
export function yieldCurveImpacts(curve:YieldCurve):AssetImpact[]{
 const risingLong=curve.y10>curve.y2;
 if(curve.shape==='INVERTIDA') return [
  {asset:'USD',direction:'MIXTO',confidence:55,reason:'La inversión señala tensión/recesión, pero las tasas cortas sostienen el dólar.'},
  {asset:'NASDAQ',direction:'PRESIONA',confidence:65,reason:'La curva invertida eleva riesgo de desaceleración y valoración.'},
  {asset:'ORO',direction:'FAVORECE',confidence:58,reason:'El riesgo macro puede aumentar demanda defensiva.'},
  {asset:'BTC',direction:'MIXTO',confidence:45,reason:'Compiten presión de liquidez y demanda alternativa.'}
 ];
 return [
  {asset:'USD',direction:risingLong?'FAVORECE':'MIXTO',confidence:52,reason:'Rendimientos largos relativamente altos pueden atraer capital en dólares.'},
  {asset:'NASDAQ',direction:'PRESIONA',confidence:58,reason:'Rendimientos de largo plazo elevados reducen el valor presente de beneficios futuros.'},
  {asset:'ORO',direction:'PRESIONA',confidence:50,reason:'Mayores rendimientos aumentan el coste de oportunidad de mantener oro.'},
  {asset:'BTC',direction:'PRESIONA',confidence:45,reason:'Condiciones financieras más estrictas suelen reducir apetito especulativo.'}
 ];
}
