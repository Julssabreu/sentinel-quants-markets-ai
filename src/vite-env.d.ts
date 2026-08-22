/// <reference types="vite/client" />

interface LiveInstrument {
  symbol: string;
  price: number;
  change: number | null;
  source: string;
  sourceUrl: string;
  observedAt: string;
  freshness: string;
}

interface MarketSnapshot {
  checkedAt: string;
  instruments: LiveInstrument[];
  errors: string[];
  evidenceHash?: string;
}

interface Window {
  sentinel?: {
    platform: string;
    version: string;
    getMarketSnapshot: () => Promise<MarketSnapshot>;
    getMacroSnapshot: () => Promise<MacroSnapshot>;
    getNewsSnapshot: () => Promise<NewsSnapshot>;
    getSecCompanySnapshot: (ticker: string) => Promise<import('./dailyIntelligence').EdgarSnapshot>;
    getSecEdgarConfig: () => Promise<{ok:boolean;config:{schemaVersion:number;contact:string}}>;
    saveSecEdgarConfig: (value: {contact: string}) => Promise<{ok:boolean;config:{schemaVersion:number;contact:string}}>;
    getDailyReportConfig: () => Promise<{ok:boolean;config:{schemaVersion:number;enabled:boolean};schedule:{stopped:boolean;running:boolean;lastRunAt:number|null;lastError:string|null;nextRunAt:number|null;utcHour:number;utcMinute:number}|null}>;
    saveDailyReportConfig: (value: {enabled: boolean}) => Promise<{ok:boolean;config:{schemaVersion:number;enabled:boolean}}>;
    sendDailyReportNow: () => Promise<{ok:boolean;charCount:number}>;
    getEvidenceLedgerStatus: () => Promise<{ok:boolean;entries:number;brokenAt:number|null;lastHash:string;sizeBytes:number;recovered:boolean;retentionPolicy:{activeMaxBytes:number;archiveCompression:'gzip';archiveDeletion:false}}>;
    repairEvidenceLedger: () => Promise<{ok:boolean;repaired:boolean;entries:number;lastHash:string}>;
    listQuantDatasets: () => Promise<{ok:boolean;datasets:QuantDatasetSummary[]}>;
    prepareQuantExperiment: (request:Record<string,unknown>) => Promise<{ok:boolean;experiment:{experimentId:string;datasetId:string;status:'PREPARED';preparedAt:string}}>;
    importMt5QuantDataset: (request:{symbol:string;assetClass:string;timeframes:string[];count:number}) => Promise<{ok:boolean;created:boolean;dataset:QuantDatasetSummary}>;
    importMt5CsvDatasets: () => Promise<{ok:boolean;imported:{created:boolean;dataset:QuantDatasetSummary}[]}>;
    loadQuantDataset: (datasetId:string) => Promise<{ok:boolean;provenance:QuantDatasetSummary & {qualityReports?:Array<{timeframe:string;status:'DATA_VALID'|'DATA_WARNING'|'DATA_DEGRADED'|'DATA_INVALID'}>;broker?:string|null;exchange?:string|null;timezone?:string};raw:{schemaVersion:1;provider:string;symbol:string;instrumentId:string;assetClass:string;processingTimestamp:string;series:Record<string,Mt5Candle[]>}}>;
    saveQuantBacktest: (payload:{experimentId:string;datasetId:string}) => Promise<{ok:boolean;result:{resultId:string;status:'COMPLETED';completedAt:string};output:ReturnType<typeof import('./quantBacktestRunner').runPreparedSmcBacktest>;authority:'SENTINEL_BACKEND_V1'}>;
    runQuantBacktest: (payload:{experimentId:string;datasetId:string}) => Promise<{ok:boolean;result:{resultId:string;status:'COMPLETED';completedAt:string};output:ReturnType<typeof import('./quantBacktestRunner').runPreparedSmcBacktest>;authority:'SENTINEL_BACKEND_V1'}>;
    saveQuantValidation: (payload:{experimentId:string;stage:string}) => Promise<{ok:boolean;result:{resultId:string;status:string;completedAt:string};output:any;authority:'SENTINEL_BACKEND_V1'}>;
    registerQuantChallengers: (payload:{experimentId:string}) => Promise<{ok:boolean;models:Array<{modelId:string;status:'CHALLENGER'}>;authority:'SENTINEL_BACKEND_V1'}>;
    saveQuantAblation: (payload:{experimentId:string}) => Promise<{ok:boolean;result:{resultId:string;status:string;completedAt:string};output:any;authority:'SENTINEL_BACKEND_V1'}>;
    saveQuantParameterStability: (payload:{experimentId:string}) => Promise<{ok:boolean;result:{resultId:string;status:string;completedAt:string};output:any;authority:'SENTINEL_BACKEND_V1'}>;
    listPaperEvents: () => Promise<{ok:boolean;events:import('./paperTradingEngine').PaperEvent[]}>;
    appendPaperEvents: (events:import('./paperTradingEngine').PaperEvent[]) => Promise<{ok:boolean;created:number;duplicates:number;activePaperIds:string[]}>;
    listShadowEvents: () => Promise<{ok:boolean;events:import('./shadowMode').ShadowEvent[]}>;
    appendShadowEvents: (events:import('./shadowMode').ShadowEvent[]) => Promise<{ok:boolean;created:number;duplicates:number;activeShadowIds:string[]}>;
    saveLiveReadiness: (payload:{experimentId:string;report:ReturnType<typeof import('./liveReadinessCoordinator').buildLiveReadinessReport>}) => Promise<{ok:boolean;result:{resultId:string;status:string}}>;
    getInstitutionalFactors: () => Promise<InstitutionalFactorSnapshot>;
    listAlerts: () => Promise<{ok:boolean;records:SentinelAlertRecord[]}>;
    upsertAlerts: (alerts:SentinelAlertCandidate[]) => Promise<{ok:boolean;records:SentinelAlertRecord[]}>;
    reconcileOperationalAlerts: (alerts:SentinelAlertCandidate[]) => Promise<{ok:boolean;records:SentinelAlertRecord[]}>;
    acknowledgeAlert: (id:string) => Promise<{ok:boolean;record:SentinelAlertRecord|null}>;
    getWatchlists: () => Promise<{ok:boolean;config:WatchlistConfig}>;
    saveWatchlists: (config:WatchlistConfig) => Promise<{ok:boolean;config:WatchlistConfig}>;
    getSignalNotifier: () => Promise<{ok:boolean;config:SignalNotifierConfig}>;
    saveSignalNotifier: (config:SignalNotifierConfig) => Promise<{ok:boolean;config:SignalNotifierConfig}>;
    testSignalNotifier: () => Promise<{ok:boolean}>;
    deliverSignal: (payload:{fingerprint:string;message:string;symbol:string;timeframe:string;atomicSignalId:string|null;decision:string;checkedAt:string}) => Promise<{ok:boolean;status:string}>;
    retrySignalDelivery: (fingerprint:string) => Promise<{ok:boolean;status:string;verdict?:string}>;
    retryPendingSignalDeliveries: (limit?:number) => Promise<{ok:boolean;status:string;retried:number;sent:number;pending:number;abandoned:number;remaining?:number}>;
    abandonSignalDelivery: (fingerprint:string,reason:string) => Promise<{ok:boolean;status:string;verdict?:string}>;
    validateAtomicSignal: (payload:{fingerprint:string;prompt:string;messageTemplate:string;symbol:string;timeframe:string;atomicSignalId:string;algorithmApproved:boolean;recommendationAuthorized:boolean;governanceCanVote:boolean;executionAuthorized:false;analysisRecordId:string|null;checkedAt:string}) => Promise<{ok:boolean;status:string;verdict?:string;consultation?:string}>;
    validateExternalSignal: (payload:ExternalSignalValidationPayload) => Promise<{ok:boolean;status:string;verdict?:string;consultation?:string}>;
    getTradingViewConfig: () => Promise<{ok:boolean;config:TradingViewCloudflareConfig}>;
    saveTradingViewConfig: (config:TradingViewCloudflareConfig & {consumerToken?:string;clearToken?:boolean}) => Promise<{ok:boolean;config:TradingViewCloudflareConfig}>;
    testTradingViewConnection: () => Promise<{ok:boolean;remote:Record<string,unknown>}>;
    getTradingViewVixContext: (force?:boolean) => Promise<TradingViewVixContextResponse>;
    getTradingViewMarketObservations: (symbol:string,timeframe?:string,limit?:number) => Promise<TradingViewMarketObservationResponse>;
    pullTradingViewSignals: (limit?:number) => Promise<TradingViewSignalBatch>;
    acknowledgeTradingViewSignal: (id:string,outcome:TradingViewAck) => Promise<{ok:boolean}>;
    setUiZoom: (factor:number) => number;
    startCryptoFlow: (symbol:string) => Promise<CryptoFlowSnapshot>;
    stopCryptoFlow: (symbol:string) => Promise<{ok:boolean;symbol:string}>;
    getCryptoFlowSnapshot: (symbol:string) => Promise<CryptoFlowSnapshot>;
    onCryptoFlowUpdate: (callback:(snapshot:CryptoFlowSnapshot)=>void) => () => void;
    listAnalysisHistory: () => Promise<{ok:boolean;records:AnalysisHistoryRecord[]}>;
    saveAnalysisHistory: (record:Omit<AnalysisHistoryRecord,'id'|'createdAt'|'schemaVersion'>) => Promise<{ok:boolean;duplicate?:boolean;record:AnalysisHistoryRecord}>;
    evaluateAnalysisHistory: () => Promise<{ok:boolean;evaluated:number;failed:number;attempted:number;skipped:number;pending:number;batchCap:number;records:AnalysisHistoryRecord[]}>;
    getAtomicMt5: () => Promise<AtomicMt5Response>;
    testAtomicReader: () => Promise<{ok:boolean;sources:number;error?:string}>;
    getAtomicTerminals: () => Promise<AtomicTerminalResponse>;
    installAtomicReader: (terminalId:string) => Promise<AtomicInstallResponse>;
    getMt5Status: () => Promise<Record<string, unknown>>;
    refreshOperationalHealth: () => Promise<{ok:boolean;snapshot:import('./operationalHealthSnapshot').OperationalHealthSnapshot}>;
    getLatestOperationalHealth: () => Promise<{ok:boolean;snapshot:import('./operationalHealthSnapshot').OperationalHealthSnapshot|null}>;
    getOperationalHealthHistory: (limit?:number) => Promise<{ok:boolean;snapshots:import('./operationalHealthSnapshot').OperationalHealthSnapshot[];total:number;retentionPolicy:{retentionDays:number;automaticDeletion:false}}>;
    getOperationalCollectorStatus: () => Promise<{ok:boolean;state:{running:boolean;stopped:boolean;lastStartedAt:number|null;lastCompletedAt:number|null;lastFailureAt:number|null;lastError:string|null;consecutiveFailures:number;nextEligibleAt:number|null;attempts:number;successes:number;failures:number;successRate:number|null;skippedOverlapping:number;skippedTooSoon:number;skippedBackoff:number;intervalMs:number}|null;liveEnabled:false;executionAuthorized:false}>;
    saveAutonomousRuntimeHeartbeat: (heartbeat:import('./autonomousRuntime').AutonomousRuntimeReport) => Promise<{ok:boolean;heartbeat:import('./autonomousRuntime').AutonomousRuntimeReport&{schemaVersion:1;persistedAt:string}}>;
    getAutonomousRuntimeHeartbeat: () => Promise<{ok:boolean;heartbeat:(import('./autonomousRuntime').AutonomousRuntimeReport&{schemaVersion:1;persistedAt:string})|null}>;
    getMt5Portfolio: () => Promise<Mt5PortfolioResponse>;
    getMt5Factors: () => Promise<Mt5FactorResponse>;
    getMt5Microstructure: (symbol:string) => Promise<Mt5MicrostructureResponse>;
    searchMt5Symbols: (search: string, limit?: number) => Promise<Mt5CatalogResponse>;
    getMt5Rates: (symbol: string, timeframe?: string, count?: number) => Promise<Mt5RatesResponse>;
    getMt5RatesAfter: (symbol:string,timeframe:string,after:string,count?:number,until?:string) => Promise<Mt5RatesAfterResponse>;
    getMt5MultiRates: (symbol: string, timeframes: string[], count?: number) => Promise<Mt5MultiRatesResponse>;
    scanMt5Market: (limit: number, force?:boolean) => Promise<Mt5ScanResponse>;
  };
}

interface MacroIndicator {
  id:string; name:string; value:number; unit:string; period:string; observedAt:string;
  source:string; sourceUrl:string; category:string; frequency:string; interpretation:string;
}
interface MacroEvent { id:string; title:string; currency:string; impact:string; scheduledAt:string; forecast:string|null; previous:string|null; source:string; sourceUrl:string; quality:string }
interface YieldCurve { date:string; y2:number; y5:number; y10:number; y30:number; spread10y2y:number; shape:string; source:string; sourceUrl:string }
interface MacroSnapshot { checkedAt:string; indicators:MacroIndicator[]; events:MacroEvent[]; yieldCurve:YieldCurve|null; errors:string[]; evidenceHash?:string }
interface NewsArticle { id:string; title:string; url:string; publishedAt:string; source:string; credibility:number; summary:string; sourceCountry?:string|null }
interface NewsSnapshot { checkedAt:string; articles:NewsArticle[]; errors:string[]; sources:{name:string;type:string}[]; evidenceHash?:string }
interface InstitutionalFactorSnapshot { checkedAt:string; realYields:{date:string;y5:number;y7:number;y10:number;y20:number;y30:number;source:string}|null; cot:Array<{market:string;date:string;openInterest:number|null;assetManagerNet?:number;leveragedFundsNet?:number;producerNet?:number;managedMoneyNet?:number;source:string}>; cryptoDerivatives:{symbol:string;markPrice:number;indexPrice:number;fundingRate:number;fundingAnnualizedPct:number;nextFundingTime:string;openInterest:number;openInterestValue:number|null;openInterest24hChangePct:number|null;takerBuySellRatio:number|null;longShortAccountRatio:number|null;longAccountPct:number|null;shortAccountPct:number|null;observedAt:string;source:string}|null; errors:string[]; permissions:string; evidenceHash?:string }
interface CryptoFlowSnapshot { ok:boolean;symbol:string;status:string;connected:boolean;startedAt:string;observedAt:string|null;lastTradeAt:string|null;lastLiquidationAt:string|null;lastBookAt:string|null;windowMs?:number;windowFrom?:string;tradeCount:number;buyNotional:number;sellNotional:number;takerImbalance:number;liquidationCount:number;longLiquidationNotional:number;shortLiquidationNotional:number;liquidationImbalance:number;bid:number|null;ask:number|null;spreadBps:number|null;reconnects:number;source:string;permissions:string }
interface SentinelAlertCandidate { fingerprint:string;category:'MACRO'|'INSTITUTIONAL'|'MICROSTRUCTURE'|'CRYPTO_FLOW'|'DATA';severity:'INFO'|'VIGILAR'|'ALTA'|'CRITICA';symbol:string|null;title:string;details:string;source:string;expiresAt:string|null }
interface SentinelAlertRecord extends SentinelAlertCandidate { id:string;createdAt:string;lastSeenAt:string;acknowledgedAt?:string;resolvedAt?:string;count:number;status:'ACTIVE'|'ACKNOWLEDGED'|'RESOLVED';schemaVersion:number }
interface SentinelWatchlist { id:string;name:string;symbols:string[];enabled:boolean }
interface WatchlistConfig { schemaVersion:1;activeListId:string;intervalMinutes:number;lists:SentinelWatchlist[] }
interface SignalNotifierConfig { schemaVersion:3;enabled:boolean;channel:'whatsapp';target:string;timeframes:string[];intervalMinutes:number;minConfidence:number;riskPercent:number;maxSymbols:number;keepInTray:boolean;startWithWindows:boolean }
interface TradingViewCloudflareConfig { schemaVersion:1;enabled:boolean;endpoint:string;pollSeconds:number;maxAgeMinutes:number;hasToken:boolean }
interface TradingViewVixDailyPoint { id:string;source:'TRADINGVIEW';contextType:'MARKET_CONTEXT';symbol:'VIX';rawSymbol:string;exchange:string|null;timeframe:'D1';observationDate:string;value:number;open:number|null;high:number|null;low:number|null;close:number|null;observedAt:string;receivedAt:string;metadata:Record<string,unknown>|null;updatedAt:string }
interface TradingViewVixContextResponse { ok:boolean;status:'READY'|'CACHED'|'DISABLED'|'UNAVAILABLE';contextType:'MARKET_CONTEXT';symbol:'VIX';operationalSignal:false;snapshot:TradingViewVixDailyPoint|null;history:TradingViewVixDailyPoint[];checkedAt:string;fetchedAt:string|null;endpoint?:string;error:string|null }
interface TradingViewMarketObservation { id:string;source:'TRADINGVIEW';contextType:'MARKET_OBSERVATION';operationalSignal:false;rawSymbol:string;exchange:string|null;marketType:string|null;timeframe:string;observedAt:string;open:number;high:number;low:number;close:number;volume:number|null;currency:string|null;baseCurrency:string|null;receivedAt:string;metadata:Record<string,unknown>|null;updatedAt:string }
interface TradingViewMarketObservationResponse { ok:boolean;status:'READY'|'DISABLED'|'UNAVAILABLE';contextType:'MARKET_OBSERVATION';operationalSignal:false;symbol:string;timeframe:string|null;observations:TradingViewMarketObservation[];checkedAt:string;error:string|null }
interface TradingViewSignal { id:string;source:'TRADINGVIEW';symbol:string;rawSymbol:string;exchange:string|null;timeframe:string;side:'BUY'|'SELL';price:number|null;emittedAt:string|null;receivedAt:string;strategy:string|null;leaseToken:string;leaseUntil:string;attempts:number;retryReason:string|null }
interface TradingViewSignalBatch { ok:boolean;status?:string;signals:TradingViewSignal[];checkedAt:string }
interface TradingViewAck { status:'PROCESSED'|'EXPIRED'|'REJECTED'|'RETRY';leaseToken:string;retryAfterSeconds?:number;verdict?:string;detail?:string }
interface ExternalSignalValidationPayload { fingerprint:string;prompt:string;messageTemplate:string;source:'TRADINGVIEW';sourceSignalId:string;symbol:string;timeframe:string;algorithmApproved:boolean;recommendationAuthorized:boolean;governanceCanVote:boolean;executionAuthorized:false;analysisRecordId:string|null;checkedAt:string }
interface Mt5MicrostructureResponse { ok:boolean; requested:string; symbol:string; windowMinutes:number; tickCount:number; midObservations:number; spreadPointsCurrent:number|null; spreadPointsMean:number|null; spreadPointsMax:number|null; tickImbalance:number; tradeFlagImbalance:number|null; buyTradeFlags:number; sellTradeFlags:number; realVolume:number; depthAvailable:boolean; depth:{type:number;price:number;volume:number}[]; buyDepth:number; sellDepth:number; depthImbalance:number|null; quality:'REAL_TRADES_AND_DOM'|'BROKER_TICKS_AND_OPTIONAL_DOM'; observedAt:string; source:string; permissions:string; error?:string; detail?:string }
interface AnalysisHistoryRecord { id:string; createdAt:string; schemaVersion:number; legacySemantics?:boolean; analysisFingerprint?:string; symbol:string; brokerSymbol:string; timeframe:string; decision:string; confidence:number; analyticalDecision?:string; analyticalConfidence?:number; maturityStatus?:import('./modelGovernance').ModelStatus; maturitySample?:number; recommendationStatus?:import('./decisionPosture').RecommendationStatus; recommendationAuthorized?:boolean; executionStatus?:'DISABLED'; executionAuthorized?:false; simulationEligible?:boolean; simulationFingerprint?:string|null; simulationAnchorTime?:string|null; planMode?:'SIMULATION'|null; authorizationReasons?:string[]; technicalConfidence:number; alignment:number; eventAction:string; blockingEvent:string|null; regime?:string; strategy?:string; modelId?:string; modelVersion?:string; modelFingerprint?:string; dataCheckedAt?:string; dataQualityScore?:number; dataWarnings?:string[]; evidenceHash?:string; marketRoute?:import('./marketSourceRouter').MarketRouteSnapshot; volatilityContext?:import('./decisionEngine').DecisionVolatilityContext; plan:{direction:string|null;trigger:number|null;maxEntry?:number|null;stop:number|null;tp1:number|null;tp2:number|null;expiresAfterBars?:number;mode?:'SIMULATED'}|null; sources:string[]; lastEvaluationAttemptAt?:string|null; lastEvaluationError?:string|null; outcome:null|{status:string;checkedAt:string;activatedAt?:string|null;activationPrice?:number|null;resolvedAt?:string;lastEvaluatedAt?:string|null;barsObserved?:number;mfe?:number;mae?:number;tp1Reached?:boolean;resolution?:string;fillPrice?:number;dataHasMore?:boolean;queryUntil?:string;source?:string;notes?:string} }

interface AtomicMt5Signal { id:string|null; type:string; symbol:string; timeframe:string; time:string|null; value:number; buyBuffer:number; sellBuffer:number; source:string; raw:string }
interface AtomicMt5Status { symbol:string; timeframe:string; bar:string; buyValue:number; sellValue:number; buyCopied:number; sellCopied:number; updated:string; mode:string; buyBuffer:number; sellBuffer:number }
interface AtomicMt5Response { ok:boolean; active:boolean; statusFileModifiedAt:string|null; signalFileModifiedAt:string|null; status:AtomicMt5Status|null; signals:AtomicMt5Signal[]; latest:AtomicMt5Signal|null; permissions?:string }
interface AtomicTerminal { id:string; root:string; atomicInstalled:boolean; bridgeInstalled:boolean; bridgePath:string }
interface AtomicTerminalResponse { ok:boolean; terminals:AtomicTerminal[] }
interface AtomicInstallResponse { ok:boolean; terminal:AtomicTerminal; restartRequired:boolean; permissions:string }
interface Mt5InstrumentMetadata { symbol:string; description:string; path:string; category:string; exchange:string; isin:string; sector:string|number|null; industry:string|number|null; currencyBase:string; currencyProfit:string; currencyMargin:string; tradeCalcMode:number }
interface Mt5CatalogSymbol extends Mt5InstrumentMetadata { canonical:string; digits:number; contractSize:number; volumeMin:number; volumeMax:number; volumeStep:number; visible:boolean }
interface Mt5CatalogResponse { ok:boolean; total?:number; returned?:number; symbols?:Mt5CatalogSymbol[]; error?:string; detail?:string; code?:number }
interface Mt5ScanFrame { close:number; ema20:number; ema50:number; atr:number; slopePct:number; relativeVolume:number; direction:number; bars:number }
interface Mt5ScanCandidate { symbol:string; canonical:string; description:string; path:string; instrument?:Mt5InstrumentMetadata; direction:'BUY'|'SELL'|'ESPERAR'; score:number; spreadPoints:number; tickAgeMinutes:number; marketStatus:'ACTIVO'|'DESACTUALIZADO/CERRADO'; h1:Mt5ScanFrame; h4:Mt5ScanFrame; observedAt:string; source:string }
interface Mt5ScanResponse { ok:boolean; scanned:number; qualified:number; candidates:Mt5ScanCandidate[]; method:string; permissions:string; checkedAt:string; cacheStatus?:'FRESH'|'CACHED'; error?:string }
interface Mt5Position { ticket:number; symbol:string; canonical:string; side:'BUY'|'SELL'; volume:number; priceOpen:number; priceCurrent:number; stopLoss:number; takeProfit:number; profit:number; swap:number; currencyProfit:string; contractSize:number; tickSize:number; tickValueLoss:number; bid:number|null; ask:number|null; openedAt:string; hasStop:boolean; magic:number }
interface Mt5AccountSnapshot { currency:string; balance:number; equity:number; margin:number; marginFree:number; marginLevel:number; profit:number; leverage:number }
interface Mt5PortfolioResponse { ok:boolean; account:Mt5AccountSnapshot; positions:Mt5Position[]; checkedAt:string; permissions:string; error?:string }
interface Mt5Factor { id:string; symbol:string; description:string; price:number; change1h:number; change24h:number; change5d:number; volatility48h:number; tickAgeMinutes:number; fresh:boolean; source:string }
interface Mt5FactorResponse { ok:boolean; factors:Mt5Factor[]; errors:string[]; checkedAt:string; permissions:string }

interface Mt5Candle {
  time: string; open: number; high: number; low: number; close: number;
  tickVolume: number; spread: number; realVolume: number;
}

interface Mt5ClockInfo {
  status:'UTC_CONFIRMED'|'BROKER_CLOCK_CORRECTED'|'UNVERIFIED';
  offsetSeconds:number;
  sampleCount:number;
  measuredAt:string;
}

interface Mt5RatesResponse {
  ok: boolean; requested?: string; symbol?: string; canonical?: string; timeframe?: string;
  digits?: number; candles?: Mt5Candle[]; source?: string; error?: string; detail?: string;
  permissions?: string; liveOrderSent?: false; executionAuthorized?: false;
  instrument?: Mt5InstrumentMetadata;
  resolution?: { method:'EXACT_BROKER_SYMBOL'|'EXACT_CANONICAL'|'UNIQUE_BROKER_SUFFIX'; score:[number,number]; ambiguous:false };
  candidates?: Mt5InstrumentMetadata[];
  specification?: { contractSize:number; tickSize:number; tickValue:number; tickValueProfit:number; tickValueLoss:number; volumeMin:number; volumeMax:number; volumeStep:number; currencyProfit:string; currencyMargin:string };
  tick?: { bid: number; ask: number; last: number; time: string } | null;
  clock?: Mt5ClockInfo;
}

interface Mt5RatesAfterResponse extends Mt5RatesResponse {
  after:string;
  queryUntil:string;
  hasMore:boolean;
  pageLimit:number;
  permissions:'read-only';
  liveOrderSent:false;
  executionAuthorized:false;
}

interface Mt5MultiRatesResponse {
  ok: boolean; requested: string; requestedTimeframes: string[]; availableTimeframes: string[];
  results: Record<string, Mt5RatesResponse>; source: string;
  clock?: Mt5ClockInfo;
}

interface QuantDatasetSummary { datasetId:string; provider:string; instrumentId:string; symbol:string; assetClass:string; dateFrom:string|null; dateTo:string|null; resolution:string; timeframes?:string[]; rows:number; rowsByTimeframe?:Record<string,number>; checksum:string; qualityStatus:'DATA_VALID'|'DATA_WARNING'|'DATA_DEGRADED'|'DATA_INVALID'; qualityReportId:string|null }
