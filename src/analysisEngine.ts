export interface Candle {
  time: string; open: number; high: number; low: number; close: number;
  tickVolume?: number; spread?: number; realVolume?: number;
}

export type MarketRegime = 'ALCISTA' | 'BAJISTA' | 'RANGO' | 'VOLATIL' | 'DATOS_INSUFICIENTES';

export interface TechnicalAnalysis {
  regime: MarketRegime;
  score: number;
  confidence: number;
  dataQuality: number;
  indicators: {
    ema20: number; ema50: number; rsi14: number; atr14: number;
    atrPercent: number; slope20: number; zScore20: number;
    stochRsiK: number; stochRsiD: number;
    macd: number; macdSignal: number; macdHistogram: number;
  } | null;
  evidence: string[];
  warnings: string[];
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function ema(values: number[], period: number): number {
  if (values.length < period || period < 1) return Number.NaN;
  const alpha = 2 / (period + 1);
  let result = mean(values.slice(0, period));
  for (const value of values.slice(period)) result = alpha * value + (1 - alpha) * result;
  return result;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return Number.NaN;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let gains = mean(changes.slice(0, period).map(value => Math.max(value, 0)));
  let losses = mean(changes.slice(0, period).map(value => Math.max(-value, 0)));
  for (const change of changes.slice(period)) {
    gains = (gains * (period - 1) + Math.max(change, 0)) / period;
    losses = (losses * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

function emaSeries(values:number[],period:number):(number|null)[]{const output:(number|null)[]=Array(values.length).fill(null);if(values.length<period)return output;const alpha=2/(period+1);let current=mean(values.slice(0,period));output[period-1]=current;for(let i=period;i<values.length;i++){current=alpha*values[i]+(1-alpha)*current;output[i]=current}return output}
function rsiSeries(values:number[],period=14):(number|null)[]{const output:(number|null)[]=Array(values.length).fill(null);if(values.length<=period)return output;const changes=values.slice(1).map((value,index)=>value-values[index]);let gains=mean(changes.slice(0,period).map(x=>Math.max(x,0))),losses=mean(changes.slice(0,period).map(x=>Math.max(-x,0)));const value=()=>losses===0?(gains===0?50:100):100-100/(1+gains/losses);output[period]=value();for(let i=period;i<changes.length;i++){gains=(gains*(period-1)+Math.max(changes[i],0))/period;losses=(losses*(period-1)+Math.max(-changes[i],0))/period;output[i+1]=value()}return output}
export function macd(values:number[],fast=12,slow=26,signalPeriod=9){const fastSeries=emaSeries(values,fast),slowSeries=emaSeries(values,slow),macdSeries=values.map((_,i)=>fastSeries[i]!=null&&slowSeries[i]!=null?fastSeries[i]!-slowSeries[i]!:null),valid=macdSeries.filter((x):x is number=>x!=null),signalSeries=emaSeries(valid,signalPeriod),macdValue=valid.at(-1)??Number.NaN,signal=signalSeries.at(-1)??Number.NaN;return{macd:macdValue,signal,histogram:macdValue-signal}}
export function stochRsi(values:number[],smoothK=3,smoothD=3,rsiPeriod=14,stochPeriod=14){const rsis=rsiSeries(values,rsiPeriod),raw:number[]=[];for(let i=0;i<rsis.length;i++){if(rsis[i]==null)continue;const window=rsis.slice(Math.max(0,i-stochPeriod+1),i+1).filter((x):x is number=>x!=null);if(window.length<stochPeriod)continue;const low=Math.min(...window),high=Math.max(...window);raw.push(high===low?50:100*(rsis[i]!-low)/(high-low))}const sma=(input:number[],period:number)=>input.length>=period?mean(input.slice(-period)):Number.NaN,kValues=raw.map((_,i)=>sma(raw.slice(0,i+1),smoothK)).filter(Number.isFinite),k=kValues.at(-1)??Number.NaN,d=sma(kValues,smoothD);return{k,d}}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length <= period) return Number.NaN;
  const ranges = candles.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - candles[index].close),
    Math.abs(candle.low - candles[index].close)
  ));
  let result = mean(ranges.slice(0, period));
  for (const range of ranges.slice(period)) result = (result * (period - 1) + range) / period;
  return result;
}

export function linearSlope(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

export function zScore(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  const deviation = Math.sqrt(mean(values.map(value => (value - average) ** 2)));
  return deviation === 0 ? 0 : (values.at(-1)! - average) / deviation;
}

export function analyzeCandles(candles: Candle[]): TechnicalAnalysis {
  const valid = candles.filter(candle =>
    Number.isFinite(candle.open) && Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) && Number.isFinite(candle.close) &&
    candle.high >= candle.low && candle.close > 0
  );
  const dataQuality = Math.round(100 * valid.length / Math.max(candles.length, 1));
  if (valid.length < 60) return {
    regime: 'DATOS_INSUFICIENTES', score: 0, confidence: 0, dataQuality,
    indicators: null, evidence: [], warnings: [`Se requieren al menos 60 velas válidas; disponibles: ${valid.length}.`]
  };

  const closes = valid.map(candle => candle.close);
  const last = closes.at(-1)!;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(valid, 14);
  const atrPercent = 100 * atr14 / last;
  const slope20 = 100 * linearSlope(closes.slice(-20)) / last;
  const zScore20 = zScore(closes.slice(-20));
  const stoch=stochRsi(closes,3,3,14,14);
  const macdValue=macd(closes,12,26,9);
  const evidence: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (last > ema20 && ema20 > ema50) { score += 35; evidence.push('Precio y medias alineados al alza.'); }
  else if (last < ema20 && ema20 < ema50) { score -= 35; evidence.push('Precio y medias alineados a la baja.'); }
  if (slope20 > 0.01) { score += 20; evidence.push('Pendiente reciente positiva.'); }
  else if (slope20 < -0.01) { score -= 20; evidence.push('Pendiente reciente negativa.'); }
  if (rsi14 >= 55 && rsi14 <= 72) score += 15;
  else if (rsi14 <= 45 && rsi14 >= 28) score -= 15;
  if(stoch.k>stoch.d&&macdValue.histogram>0){score+=10;evidence.push('Stoch RSI 3,3,14,14 y MACD 12,26,9 confirman impulso alcista.');}
  else if(stoch.k<stoch.d&&macdValue.histogram<0){score-=10;evidence.push('Stoch RSI 3,3,14,14 y MACD 12,26,9 confirman impulso bajista.');}
  else evidence.push('Stoch RSI y MACD no ofrecen confirmación conjunta.');
  if (Math.abs(zScore20) > 2) warnings.push('Precio estadísticamente extendido frente a las últimas 20 velas.');
  if (atrPercent > 2.5) warnings.push('Volatilidad relativa elevada; requiere mayor margen de riesgo.');
  if (dataQuality < 98) warnings.push('Existen velas inválidas o incompletas en la muestra.');

  const volatile = atrPercent > 3.5;
  const regime: MarketRegime = volatile ? 'VOLATIL' : score >= 35 ? 'ALCISTA' : score <= -35 ? 'BAJISTA' : 'RANGO';
  const confidence = Math.min(85, Math.round(Math.abs(score) * 0.85 + Math.min(valid.length / 20, 10)));
  return {
    regime, score, confidence, dataQuality,
    indicators: { ema20, ema50, rsi14, atr14, atrPercent, slope20, zScore20,stochRsiK:stoch.k,stochRsiD:stoch.d,macd:macdValue.macd,macdSignal:macdValue.signal,macdHistogram:macdValue.histogram },
    evidence, warnings
  };
}
