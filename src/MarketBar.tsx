import {
  DAILY_INTELLIGENCE_SECTIONS,
  DAILY_MARKET_TABS,
  type DailyIntelligenceSection,
  type DailyMarketTab,
} from './marketNavigation';

interface MarketBarProps {
  market: DailyMarketTab;
  section: DailyIntelligenceSection;
  onMarketChange: (market: DailyMarketTab) => void;
  onSectionChange: (section: DailyIntelligenceSection) => void;
}

export default function MarketBar({
  market,
  section,
  onMarketChange,
  onSectionChange,
}: MarketBarProps) {
  return <div className="sentinel-market-bar" aria-label="Mercados y secciones de inteligencia">
    <div className="sentinel-market-tabs" role="tablist" aria-label="Mercados">
      {DAILY_MARKET_TABS.map((item) => <button
        type="button"
        role="tab"
        aria-selected={market === item.id}
        className={market === item.id ? 'active' : ''}
        key={item.id}
        onClick={() => onMarketChange(item.id)}
      >{item.label}</button>)}
    </div>
    <div className="sentinel-section-tabs" role="tablist" aria-label="Secciones">
      {DAILY_INTELLIGENCE_SECTIONS.map((item) => <button
        type="button"
        role="tab"
        aria-selected={section === item.id}
        className={section === item.id ? 'active' : ''}
        key={item.id}
        onClick={() => onSectionChange(item.id)}
      >{item.label}</button>)}
    </div>
  </div>;
}
