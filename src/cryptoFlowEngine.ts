export interface CryptoFlowAnalysis {
  available:boolean
  fresh:boolean
  bias:'COMPRADOR'|'VENDEDOR'|'NEUTRAL'
  confidence:number
  liquidationRisk:'NORMAL'|'ELEVADO'|'EXTREMO'
  warnings:string[]
}

export function analyzeCryptoFlow(snapshot:CryptoFlowSnapshot|null,now=new Date()):CryptoFlowAnalysis {
  if(!snapshot?.ok||!snapshot.observedAt)return{available:false,fresh:false,bias:'NEUTRAL',confidence:0,liquidationRisk:'NORMAL',warnings:['Flujo cripto en vivo todavía no disponible.']}
  const ageSeconds=(now.getTime()-new Date(snapshot.observedAt).getTime())/1000
  const fresh=snapshot.connected&&ageSeconds<=10
  const warnings:string[]=[]
  const taker=snapshot.takerImbalance
  const liquidations=snapshot.longLiquidationNotional+snapshot.shortLiquidationNotional
  const bias=taker>=0.12?'COMPRADOR':taker<=-0.12?'VENDEDOR':'NEUTRAL'
  const confidence=fresh?Math.min(90,Math.round(Math.abs(taker)*160+Math.min(snapshot.tradeCount/100,30))):0
  const liquidationRisk=liquidations>=10_000_000?'EXTREMO':liquidations>=1_000_000?'ELEVADO':'NORMAL'
  if(liquidationRisk!=='NORMAL')warnings.push(`Liquidaciones acumuladas: USD ${liquidations.toLocaleString('es-BO',{maximumFractionDigits:0})}.`)
  if(snapshot.longLiquidationNotional>snapshot.shortLiquidationNotional*2&&liquidations>100_000)warnings.push('Cascada predominante de liquidaciones long; presión bajista y riesgo de reversión violenta.')
  if(snapshot.shortLiquidationNotional>snapshot.longLiquidationNotional*2&&liquidations>100_000)warnings.push('Cascada predominante de liquidaciones short; presión alcista y riesgo de reversión violenta.')
  if(snapshot.spreadBps!==null&&snapshot.spreadBps>=5)warnings.push(`Spread del futuro elevado: ${snapshot.spreadBps.toFixed(2)} pb.`)
  if(!snapshot.lastTradeAt)warnings.push('Canal aggTrade sin observaciones; el flujo taker queda sin voto y se conserva el respaldo REST.')
  if(!snapshot.lastBookAt)warnings.push('Canal bookTicker sin observaciones; spread en vivo no disponible.')
  if(!fresh)warnings.push('Flujo WebSocket desconectado o atrasado; queda sin voto.')
  return{available:true,fresh,bias:snapshot.lastTradeAt?bias:'NEUTRAL',confidence:snapshot.lastTradeAt?confidence:0,liquidationRisk,warnings}
}
