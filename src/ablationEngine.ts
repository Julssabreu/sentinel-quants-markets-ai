import { calculateQuantStatistics, type QuantStatistics } from './quantStatistics';
export interface AblationResult { removedFeature:string | null; statistics:QuantStatistics; expectancyDeltaR:number | null; profitFactorDelta:number | null; }
export function runAblationStudy(features:readonly string[], runner:(enabledFeatures:readonly string[])=>readonly number[]):AblationResult[]{
  const baseline=calculateQuantStatistics(runner(features));
  const result:AblationResult[]=[{removedFeature:null,statistics:baseline,expectancyDeltaR:0,profitFactorDelta:0}];
  for(const removedFeature of features){const statistics=calculateQuantStatistics(runner(features.filter(feature=>feature!==removedFeature)));result.push({removedFeature,statistics,expectancyDeltaR:statistics.expectancyR==null||baseline.expectancyR==null?null:statistics.expectancyR-baseline.expectancyR,profitFactorDelta:statistics.profitFactor==null||baseline.profitFactor==null?null:statistics.profitFactor-baseline.profitFactor})}
  return result;
}
