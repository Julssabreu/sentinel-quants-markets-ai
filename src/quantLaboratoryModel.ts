import { SENTINEL_QUANT_VERSIONS } from "./sentinelQuantVersions";

export const QUANT_LAB_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;
export type QuantLabTimeframe = (typeof QUANT_LAB_TIMEFRAMES)[number];
export type QuantLabAssetClass = "FOREX" | "INDEX" | "EQUITY" | "METAL" | "ENERGY" | "CRYPTO" | "FUTURE";

export interface QuantLaboratoryConfig {
  assetClass: QuantLabAssetClass;
  symbol: string;
  dateFrom: string;
  dateTo: string;
  timeframes: { bias: QuantLabTimeframe; levels: QuantLabTimeframe; setup: QuantLabTimeframe; refinement: QuantLabTimeframe; trigger: QuantLabTimeframe };
  execution: { spreadBps: number; slippageBps: number; commissionBps: number };
  risk: { riskPercent: number; minimumRR: number };
}

export type LaboratoryReasonCode = "LAB_SYMBOL_REQUIRED" | "LAB_DATE_RANGE_INVALID" | "LAB_COST_INVALID" | "LAB_RISK_INVALID" | "LAB_TIMEFRAME_ORDER_INVALID";
const MINUTES: Record<QuantLabTimeframe, number> = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080 };

export function createDefaultQuantLaboratoryConfig(): QuantLaboratoryConfig {
  return { assetClass: "FOREX", symbol: "EURUSD", dateFrom: "2020-01-01", dateTo: "2025-12-31", timeframes: { bias: "D1", levels: "H4", setup: "H1", refinement: "M15", trigger: "M5" }, execution: { spreadBps: 1, slippageBps: 0.5, commissionBps: 0 }, risk: { riskPercent: 0.5, minimumRR: 1.5 } };
}

export interface QuantDatasetConfigIdentity{symbol:string;assetClass:string;dateFrom:string|null;dateTo:string|null;}
const DATASET_TO_LAB_ASSET:Record<string,QuantLabAssetClass>={FOREX:'FOREX',INDEX:'INDEX',EQUITY:'EQUITY',STOCK:'EQUITY',METAL:'METAL',ENERGY:'ENERGY',COMMODITY:'ENERGY',CRYPTO:'CRYPTO',FUTURE:'FUTURE'};
const dateOnly=(value:string|null)=>{if(!value)return null;const match=value.match(/^(\d{4}-\d{2}-\d{2})/);return match?.[1]??null};

export function synchronizeQuantConfigWithDataset(config:QuantLaboratoryConfig,dataset:QuantDatasetConfigIdentity):QuantLaboratoryConfig{
  const assetClass=DATASET_TO_LAB_ASSET[dataset.assetClass.trim().toUpperCase()];
  if(!assetClass)throw new Error(`Clase de dataset no soportada por Quant: ${dataset.assetClass}.`);
  const from=dateOnly(dataset.dateFrom),to=dateOnly(dataset.dateTo);
  return{...config,symbol:dataset.symbol.trim().toUpperCase(),assetClass,dateFrom:from??config.dateFrom,dateTo:to??config.dateTo};
}

export function validateQuantLaboratoryConfig(config: QuantLaboratoryConfig): LaboratoryReasonCode[] {
  const reasons: LaboratoryReasonCode[] = [];
  if (!config.symbol.trim()) reasons.push("LAB_SYMBOL_REQUIRED");
  if (!config.dateFrom || !config.dateTo || config.dateFrom >= config.dateTo) reasons.push("LAB_DATE_RANGE_INVALID");
  if (Object.values(config.execution).some((value) => !Number.isFinite(value) || value < 0)) reasons.push("LAB_COST_INVALID");
  if (!Number.isFinite(config.risk.riskPercent) || config.risk.riskPercent <= 0 || config.risk.riskPercent > 5 || !Number.isFinite(config.risk.minimumRR) || config.risk.minimumRR <= 0) reasons.push("LAB_RISK_INVALID");
  const chain = Object.values(config.timeframes).map((timeframe) => MINUTES[timeframe]);
  if (chain.some((value, index) => index > 0 && value >= chain[index - 1])) reasons.push("LAB_TIMEFRAME_ORDER_INVALID");
  return reasons;
}

export function createQuantResearchRunRequest(config: QuantLaboratoryConfig, requestedAt: string) {
  const reasons = validateQuantLaboratoryConfig(config);
  if (reasons.length) throw new Error(reasons.join(","));
  return { mode: "ANALYSIS_ONLY" as const, strategy: "SMC" as const, config: structuredClone(config), versions: SENTINEL_QUANT_VERSIONS, requestedAt };
}

export const QUANT_RESEARCH_STAGES = [
  { id: "BACKTEST", label: "Backtest causal", requirement: "Dataset validado y sincronizado" },
  { id: "OUT_OF_SAMPLE", label: "Out-of-sample", requirement: "Período congelado" },
  { id: "WALK_FORWARD", label: "Walk-forward", requirement: "OOS excluido del desarrollo" },
  { id: "MONTE_CARLO", label: "Monte Carlo", requirement: "Retornos netos disponibles" },
  { id: "ABLATION", label: "Ablation study", requirement: "Feature Set versionado" },
] as const;
