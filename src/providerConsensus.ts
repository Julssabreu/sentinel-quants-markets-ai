export interface ProviderQuote {
  provider: string;
  bid: number;
  ask: number;
  observedAt: string;
  source: 'MT5' | 'TradingView' | 'API' | 'OTRO';
}

export interface ProviderConsensus {
  referenceMid: number;
  medianSpreadPips: number;
  dispersionPips: number;
  confidence: number;
  providersUsed: number;
  outliers: string[];
  warnings: string[];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const pipSize = (symbol: string) => symbol.toUpperCase().includes('JPY') ? 0.01 : 0.0001;

export function analyzeProviderConsensus(symbol: string, quotes: ProviderQuote[]): ProviderConsensus {
  const valid = quotes.filter(quote =>
    Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.bid > 0 && quote.ask >= quote.bid
  );
  if (!valid.length) return {
    referenceMid: Number.NaN, medianSpreadPips: Number.NaN, dispersionPips: Number.NaN,
    confidence: 0, providersUsed: 0, outliers: [], warnings: ['No hay cotizaciones válidas de proveedores.']
  };

  const pip = pipSize(symbol);
  const mids = valid.map(quote => (quote.bid + quote.ask) / 2);
  const referenceMid = median(mids);
  const deviations = mids.map(mid => Math.abs(mid - referenceMid) / pip);
  const dispersionPips = Math.max(...mids.map(mid => mid / pip)) - Math.min(...mids.map(mid => mid / pip));
  const medianSpreadPips = median(valid.map(quote => (quote.ask - quote.bid) / pip));
  const threshold = Math.max(2, median(deviations) * 3);
  const outliers = valid.filter((_, index) => deviations[index] > threshold).map(quote => quote.provider);
  const diversityScore = Math.min(100, valid.length * 20);
  const dispersionPenalty = Math.min(70, dispersionPips * 8);
  const outlierPenalty = Math.min(30, outliers.length * 10);
  const confidence = Math.max(0, Math.round(diversityScore - dispersionPenalty - outlierPenalty));
  const warnings: string[] = [];
  if (valid.length < 3) warnings.push('Se recomiendan al menos tres proveedores independientes.');
  if (dispersionPips > 3) warnings.push('Existe divergencia relevante entre proveedores.');
  if (outliers.length) warnings.push(`Feeds atípicos detectados: ${outliers.join(', ')}.`);

  return { referenceMid, medianSpreadPips, dispersionPips, confidence, providersUsed: valid.length, outliers, warnings };
}
