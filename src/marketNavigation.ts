import type { MarketClass } from './marketArchitecture';

export type DailyMarketTab =
  | 'ALL'
  | 'STOCK'
  | 'FOREX'
  | 'CRYPTO'
  | 'INDEX'
  | 'FUTURE'
  | 'METAL'
  | 'COMMODITY'
  | 'ETF'
  | 'BOND_RATE'
  | 'OPTION';

export type DailyIntelligenceSection =
  | 'SUMMARY'
  | 'RADAR'
  | 'ANALYSIS'
  | 'CALENDAR'
  | 'NEWS'
  | 'REPORTS';

export interface MarketTabDefinition {
  id: DailyMarketTab;
  label: string;
  marketClasses: readonly MarketClass[];
}

export interface IntelligenceSectionDefinition {
  id: DailyIntelligenceSection;
  label: string;
}

export const DAILY_MARKET_TABS: readonly MarketTabDefinition[] = [
  { id:'ALL', label:'Todos', marketClasses:[] },
  { id:'STOCK', label:'Acciones', marketClasses:['STOCK'] },
  { id:'FOREX', label:'Forex', marketClasses:['FOREX'] },
  { id:'CRYPTO', label:'Cripto', marketClasses:['CRYPTO'] },
  { id:'INDEX', label:'Índices', marketClasses:['INDEX'] },
  { id:'FUTURE', label:'Futuros', marketClasses:['FUTURE'] },
  { id:'METAL', label:'Metales', marketClasses:['METAL'] },
  { id:'COMMODITY', label:'Materias primas', marketClasses:['COMMODITY'] },
  { id:'ETF', label:'ETF', marketClasses:['ETF'] },
  { id:'BOND_RATE', label:'Bonos / tasas', marketClasses:['BOND_RATE'] },
  { id:'OPTION', label:'Opciones', marketClasses:['OPTION'] },
] as const;

export const DAILY_INTELLIGENCE_SECTIONS: readonly IntelligenceSectionDefinition[] = [
  { id:'SUMMARY', label:'Resumen' },
  { id:'RADAR', label:'Radar' },
  { id:'ANALYSIS', label:'Análisis' },
  { id:'CALENDAR', label:'Calendario' },
  { id:'NEWS', label:'Noticias' },
  { id:'REPORTS', label:'Informes' },
] as const;

export function marketMatchesTab(market: MarketClass, tab: DailyMarketTab): boolean {
  if (tab === 'ALL') return true;
  const definition = DAILY_MARKET_TABS.find((item) => item.id === tab);
  return definition?.marketClasses.includes(market) ?? false;
}

export function marketTabLabel(tab: DailyMarketTab): string {
  return DAILY_MARKET_TABS.find((item) => item.id === tab)?.label ?? 'Todos';
}
