import type { QuantSetupRecord } from './quantSetupRecord';
import { completedQuantRecords } from './quantSegmentation';
import { calculateQuantStatistics, type QuantStatistics } from './quantStatistics';

export interface ChronologicalSplit { training:QuantSetupRecord[]; validation:QuantSetupRecord[]; outOfSample:QuantSetupRecord[]; purgeCount:number; }
export function splitChronologically(records: readonly QuantSetupRecord[], ratios = { training:.6, validation:.2 }, purgeCount = 0): ChronologicalSplit {
  if (ratios.training <= 0 || ratios.validation < 0 || ratios.training + ratios.validation >= 1) throw new Error('Ratios cronológicos inválidos.');
  const sorted = completedQuantRecords(records).sort((a, b) => Date.parse(a.sourceTimestamp) - Date.parse(b.sourceTimestamp));
  const trainingEnd = Math.floor(sorted.length * ratios.training), validationEnd = Math.floor(sorted.length * (ratios.training + ratios.validation));
  return {
    training:sorted.slice(0, Math.max(0, trainingEnd - purgeCount)),
    validation:sorted.slice(Math.min(sorted.length, trainingEnd + purgeCount), Math.max(trainingEnd + purgeCount, validationEnd - purgeCount)),
    outOfSample:sorted.slice(Math.min(sorted.length, validationEnd + purgeCount)), purgeCount,
  };
}

export interface WalkForwardFoldStatistics { fold:number; trainStart:number; trainEnd:number; testStart:number; testEnd:number; train:QuantStatistics; test:QuantStatistics; }
export interface WalkForwardValidation { folds:WalkForwardFoldStatistics[]; positiveTestFoldRatio:number | null; combinedTest:QuantStatistics; stable:boolean; }
export function runRollingWalkForward(returns: readonly number[], config:{ trainSize:number; testSize:number; stepSize?:number; purgeSize?:number; minimumPositiveFoldRatio?:number }):WalkForwardValidation {
  const { trainSize, testSize } = config, step = config.stepSize ?? testSize, purge = config.purgeSize ?? 0;
  if (![trainSize, testSize, step].every(value => Number.isInteger(value) && value > 0) || purge < 0) throw new Error('Configuración walk-forward inválida.');
  const clean = returns.filter(Number.isFinite), folds:WalkForwardFoldStatistics[] = [];
  for (let trainStart = 0, fold = 1; trainStart + trainSize + purge + testSize <= clean.length; trainStart += step, fold++) {
    const trainEnd = trainStart + trainSize, testStart = trainEnd + purge, testEnd = testStart + testSize;
    folds.push({ fold, trainStart, trainEnd, testStart, testEnd, train:calculateQuantStatistics(clean.slice(trainStart, trainEnd)), test:calculateQuantStatistics(clean.slice(testStart, testEnd)) });
  }
  const testReturns = folds.flatMap(item => item.test.returns), positive = folds.filter(item => (item.test.expectancyR ?? 0) > 0).length;
  const positiveTestFoldRatio = folds.length ? positive / folds.length : null;
  return { folds, positiveTestFoldRatio, combinedTest:calculateQuantStatistics(testReturns), stable:Boolean(folds.length && positiveTestFoldRatio! >= (config.minimumPositiveFoldRatio ?? .6) && (calculateQuantStatistics(testReturns).expectancyR ?? 0) > 0) };
}
