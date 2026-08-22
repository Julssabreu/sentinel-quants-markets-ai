import { atr, type Candle } from './analysisEngine';
import { closeAtEndOfData, evaluateExitOnBar, prepareExecutedTrade, type ExecutionCostProfile } from './executionCostModel';
import { calculateQuantStatistics, type QuantStatistics } from './quantStatistics';

export interface RandomSameRrBenchmarkInput {
  candles: readonly Candle[];
  tradeCount: number;
  rewardRisk: number;
  atrMultiple: number;
  execution: ExecutionCostProfile;
  executionForBar?: (bar:Candle,index:number) => ExecutionCostProfile;
  randomSeed: number;
  warmupBars?: number;
}
export interface RandomSameRrBenchmarkResult { randomSeed:number; requestedTrades:number; completedTrades:number; returns:number[]; statistics:QuantStatistics; }

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function runRandomSameRrBenchmark(input: RandomSameRrBenchmarkInput): RandomSameRrBenchmarkResult {
  if (!Number.isInteger(input.randomSeed)) throw new Error('Benchmark requiere randomSeed entero.');
  const warmup = Math.max(15, input.warmupBars ?? 80), available = input.candles.length - warmup - 1;
  if (available <= 0 || input.tradeCount <= 0) return { randomSeed:input.randomSeed, requestedTrades:Math.max(0, input.tradeCount), completedTrades:0, returns:[], statistics:calculateQuantStatistics([]) };
  const random = mulberry32(input.randomSeed);
  const indexes = new Set<number>();
  while (indexes.size < Math.min(input.tradeCount, available)) indexes.add(warmup + Math.floor(random() * available));
  const returns:number[] = [];
  for (const signalIndex of [...indexes].sort((a, b) => a - b)) {
    const volatility = atr([...input.candles.slice(Math.max(0,signalIndex-100), signalIndex + 1)], 14);
    if (!Number.isFinite(volatility) || volatility <= 0) continue;
    const direction = random() >= .5 ? 'LONG' : 'SHORT', entryBar = input.candles[signalIndex + 1], side = direction === 'LONG' ? 1 : -1;
    const risk = volatility * input.atrMultiple;
    const entryExecution=input.executionForBar?.(entryBar,signalIndex+1)??input.execution;
    const plan = prepareExecutedTrade(direction, entryBar.open, entryBar.open - side * risk, entryBar.open + side * risk * input.rewardRisk, entryExecution);
    let exit = null;
    for (let index=signalIndex+1;index<input.candles.length;index++) { const bar=input.candles[index],barExecution=input.executionForBar?.(bar,index)??input.execution;exit = evaluateExitOnBar(plan, bar, barExecution); if (exit) break; }
    const last=input.candles.at(-1)!;
    exit ??= closeAtEndOfData(plan,last.close,input.executionForBar?.(last,input.candles.length-1)??input.execution);
    returns.push(exit.netResultR);
  }
  return { randomSeed:input.randomSeed, requestedTrades:input.tradeCount, completedTrades:returns.length, returns, statistics:calculateQuantStatistics(returns) };
}
