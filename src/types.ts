export type Decision = 'BUY' | 'SELL' | 'ESPERAR' | 'ACUMULAR' | 'NO ENTRAR';
export type AssetClass =
  | 'Forex'
  | 'Cripto'
  | 'Acción'
  | 'Índice'
  | 'ETF'
  | 'Metal'
  | 'Materia prima'
  | 'Futuro'
  | 'CFD'
  | 'Bono/Tasa'
  | 'Opción';

export interface Opportunity {
  symbol: string; name: string; assetClass: AssetClass; price: string; change: number;
  decision: Decision; confidence: number; entryQuality: number; risk: 'Bajo' | 'Moderado' | 'Alto';
  regime: string; strategy: string; spark: number[];
  dataSource?: string; observedAt?: string; isLivePrice?: boolean;
}

export interface Recommendation {
  id: string; date: string; symbol: string; decision: Decision; confidence: number; thesis: string; status: string;
}
