import { useState } from 'react';
import DailyIntelligenceCenter from './DailyIntelligenceCenter';
import MarketBar from './MarketBar';
import {
  type DailyIntelligenceSection,
  type DailyMarketTab,
} from './marketNavigation';
import { useDailyIntelligence } from './useDailyIntelligence';

interface DailyIntelligenceHomeProps {
  initialMarket?: DailyMarketTab;
  initialSection?: DailyIntelligenceSection;
  onAnalyze?: (symbol: string) => void;
}

export default function DailyIntelligenceHome({
  initialMarket = 'ALL',
  initialSection = 'SUMMARY',
  onAnalyze,
}: DailyIntelligenceHomeProps) {
  const [market, setMarket] = useState<DailyMarketTab>(initialMarket);
  const [section, setSection] = useState<DailyIntelligenceSection>(initialSection);
  const intelligence = useDailyIntelligence(market);

  return <>
    <MarketBar
      market={market}
      section={section}
      onMarketChange={setMarket}
      onSectionChange={setSection}
    />
    <DailyIntelligenceCenter
      model={intelligence.model}
      section={section}
      loading={intelligence.loading}
      scanning={intelligence.scanning}
      errors={intelligence.errors}
      onRefresh={() => void intelligence.refresh()}
      onScan={() => void intelligence.scanNow(true)}
      onAnalyze={onAnalyze}
    />
  </>;
}
