export type EquityInstrumentType = 'STOCK' | 'ETF' | 'INDEX';
export type EquityAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
export type EquityCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'INVALID';
export type EquityFreshnessStatus = 'FRESH' | 'STALE' | 'UNKNOWN' | 'FUTURE';

export type EquityContextDomain =
  | 'identity'
  | 'marketCap'
  | 'valuation'
  | 'profitability'
  | 'balanceSheet'
  | 'earnings'
  | 'corporateActions'
  | 'filings'
  | 'provenance';

export interface EquityInstrumentIdentity {
  instrumentType: EquityInstrumentType;
  ticker: string;
  exchange: string;
  currency: string;
  name?: string | null;
  countryCode?: string | null;
  sector?: string | null;
  industry?: string | null;
}

export interface EquityMarketCapitalization {
  value?: number | null;
  sharesOutstanding?: number | null;
  asOf?: string | null;
}

export interface EquityValuation {
  asOf?: string | null;
  priceToEarningsTtm?: number | null;
  forwardPriceToEarnings?: number | null;
  priceToBook?: number | null;
  priceToSalesTtm?: number | null;
  enterpriseValueToEbitdaTtm?: number | null;
  dividendYieldPercent?: number | null;
}

export interface EquityProfitability {
  periodEnd?: string | null;
  revenueTtm?: number | null;
  operatingIncomeTtm?: number | null;
  netIncomeTtm?: number | null;
  earningsPerShareTtm?: number | null;
  operatingMarginPercent?: number | null;
  netMarginPercent?: number | null;
  returnOnEquityPercent?: number | null;
  returnOnAssetsPercent?: number | null;
}

export interface EquityBalanceSheet {
  periodEnd?: string | null;
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  shareholderEquity?: number | null;
  totalDebt?: number | null;
  cashAndEquivalents?: number | null;
  currentRatio?: number | null;
  debtToEquity?: number | null;
}

export interface EquityEarnings {
  fiscalPeriod?: string | null;
  lastReportDate?: string | null;
  nextReportDate?: string | null;
  earningsPerShareActual?: number | null;
  earningsPerShareEstimate?: number | null;
  earningsPerShareSurprisePercent?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  revenueSurprisePercent?: number | null;
}

export type EquityCorporateActionType =
  | 'DIVIDEND'
  | 'SPLIT'
  | 'BUYBACK'
  | 'SPINOFF'
  | 'MERGER'
  | 'OTHER';

export interface EquityCorporateAction {
  type: EquityCorporateActionType;
  announcedAt?: string | null;
  effectiveDate?: string | null;
  description: string;
}

export interface EquityCorporateActions {
  /** Fecha de actualización de la consulta, incluso cuando items está vacío. */
  asOf?: string | null;
  items: EquityCorporateAction[];
}

export interface EquityFiling {
  filingType: string;
  filedAt: string;
  periodEnd?: string | null;
  accessionNumber?: string | null;
  url?: string | null;
}

export interface EquityFilings {
  /** Fecha de actualización de la consulta al registro regulatorio. */
  asOf?: string | null;
  items: EquityFiling[];
}

export interface EquityProvenance {
  sourceId: string;
  sourceName: string;
  retrievedAt: string;
  asOf?: string | null;
  url?: string | null;
  /** Rutas declaradas por la fuente, por ejemplo valuation.priceToBook. */
  fields: string[];
}

/**
 * Contrato normalizado de entrada. Todos los importes monetarios usan
 * instrument.currency; null/undefined significan "no disponible" y nunca se
 * sustituyen por cero ni por una estimación.
 */
export interface NormalizedEquityContext {
  schemaVersion: 'EQUITY_CONTEXT_V1';
  instrument: EquityInstrumentIdentity;
  marketCapitalization?: EquityMarketCapitalization | null;
  valuation?: EquityValuation | null;
  profitability?: EquityProfitability | null;
  balanceSheet?: EquityBalanceSheet | null;
  earnings?: EquityEarnings | null;
  corporateActions?: EquityCorporateActions | null;
  filings?: EquityFilings | null;
  provenance: EquityProvenance[];
}

export interface EquityDomainAssessment {
  domain: EquityContextDomain;
  status: EquityCoverageStatus;
  validFields: number;
  requiredFields: number;
  coveragePercent: number;
  invalidFields: string[];
  freshness: EquityFreshnessStatus;
  asOf: string | null;
  maxAgeDays: number | null;
}

export interface EquitySourceAssessment {
  sourceId: string;
  sourceName: string;
  retrievedAt: string;
  asOf: string | null;
  url: string | null;
  fields: string[];
  freshness: EquityFreshnessStatus;
}

export interface EquityContextAnalysis {
  kind: 'FUNDAMENTAL_CONTEXT';
  schemaVersion: 'EQUITY_CONTEXT_ANALYSIS_V1';
  instrumentType: EquityInstrumentType;
  ticker: string;
  exchange: string;
  currency: string;
  availability: EquityAvailability;
  acceptedInstrument: boolean;
  operationalSignal: false;
  usableForFundamentalDecision: boolean;
  coveragePercent: number;
  qualityScore: number;
  domains: EquityDomainAssessment[];
  freshDomains: EquityContextDomain[];
  staleDomains: EquityContextDomain[];
  unknownFreshnessDomains: EquityContextDomain[];
  sources: EquitySourceAssessment[];
  warnings: string[];
  assessedAt: string | null;
}

export interface AnalyzeEquityContextOptions {
  now?: Date;
}

export const EQUITY_CONTEXT_RULES = Object.freeze({
  version: 'EQUITY_CONTEXT_ANALYSIS_V1' as const,
  sourceMaxAgeDays: 7,
  freshnessDays: Object.freeze({
    marketCap: 7,
    valuation: 7,
    profitability: 220,
    balanceSheet: 220,
    earnings: 220,
    corporateActions: 30,
    filings: 30,
  }),
  minimumValidFields: Object.freeze({
    identity: 6,
    marketCap: 2,
    valuation: 4,
    profitability: 6,
    balanceSheet: 6,
    earnings: 4,
    corporateActions: 2,
    filings: 2,
    provenance: 1,
  }),
});

interface MutableDomainCheck {
  domain: EquityContextDomain;
  present: boolean;
  validFields: number;
  requiredFields: number;
  invalidFields: string[];
  asOf: string | null;
  maxAgeDays: number | null;
}

const ISO_CURRENCY = /^[A-Z]{3}$/;
const VALID_INSTRUMENT_TYPES = new Set<EquityInstrumentType>(['STOCK', 'ETF', 'INDEX']);
const VALID_ACTION_TYPES = new Set<EquityCorporateActionType>([
  'DIVIDEND', 'SPLIT', 'BUYBACK', 'SPINOFF', 'MERGER', 'OTHER',
]);
const DAY_MS = 86_400_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isValidDate(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function countValue(
  value: unknown,
  field: string,
  validator: (candidate: unknown) => boolean,
  invalidFields: string[],
): number {
  if (value === null || value === undefined) return 0;
  if (validator(value)) return 1;
  invalidFields.push(field);
  return 0;
}

function assessFreshness(
  asOf: string | null,
  maxAgeDays: number | null,
  now: Date,
): EquityFreshnessStatus {
  if (!asOf || maxAgeDays === null || !isValidDate(asOf) || !Number.isFinite(now.getTime())) {
    return 'UNKNOWN';
  }
  const ageDays = (now.getTime() - Date.parse(asOf)) / DAY_MS;
  if (ageDays < 0) return 'FUTURE';
  return ageDays <= maxAgeDays ? 'FRESH' : 'STALE';
}

function finalizeDomain(check: MutableDomainCheck, now: Date): EquityDomainAssessment {
  const { validFields, requiredFields, invalidFields } = check;
  const status: EquityCoverageStatus = !check.present
    ? 'MISSING'
    : validFields === 0 && invalidFields.length > 0
      ? 'INVALID'
      : validFields >= requiredFields && invalidFields.length === 0
        ? 'COMPLETE'
        : 'PARTIAL';
  return {
    domain: check.domain,
    status,
    validFields,
    requiredFields,
    coveragePercent: Math.round(Math.min(1, validFields / requiredFields) * 100),
    invalidFields,
    freshness: assessFreshness(check.asOf, check.maxAgeDays, now),
    asOf: check.asOf,
    maxAgeDays: check.maxAgeDays,
  };
}

function identityCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const invalidFields: string[] = [];
  const instrument = context.instrument;
  let validFields = 0;
  validFields += countValue(
    instrument.instrumentType,
    'instrument.instrumentType',
    (value) => VALID_INSTRUMENT_TYPES.has(value as EquityInstrumentType),
    invalidFields,
  );
  validFields += countValue(instrument.ticker, 'instrument.ticker', isNonEmptyString, invalidFields);
  validFields += countValue(instrument.exchange, 'instrument.exchange', isNonEmptyString, invalidFields);
  validFields += countValue(instrument.currency, 'instrument.currency', (value) => (
    isNonEmptyString(value) && ISO_CURRENCY.test(value)
  ), invalidFields);
  validFields += countValue(instrument.sector, 'instrument.sector', isNonEmptyString, invalidFields);
  validFields += countValue(instrument.industry, 'instrument.industry', isNonEmptyString, invalidFields);
  if (instrument.countryCode != null && !/^[A-Z]{2}$/.test(instrument.countryCode)) {
    invalidFields.push('instrument.countryCode');
  }
  if (instrument.name != null && !isNonEmptyString(instrument.name)) {
    invalidFields.push('instrument.name');
  }
  return {
    domain: 'identity',
    present: true,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.identity,
    invalidFields,
    asOf: null,
    maxAgeDays: null,
  };
}

function marketCapCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.marketCapitalization;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.value, 'marketCapitalization.value', isPositiveNumber, invalidFields);
    validFields += countValue(data.asOf, 'marketCapitalization.asOf', isValidDate, invalidFields);
    countValue(
      data.sharesOutstanding,
      'marketCapitalization.sharesOutstanding',
      isPositiveNumber,
      invalidFields,
    );
  }
  return {
    domain: 'marketCap',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.marketCap,
    invalidFields,
    asOf: isValidDate(data?.asOf) ? data.asOf : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.marketCap,
  };
}

function valuationCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.valuation;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.asOf, 'valuation.asOf', isValidDate, invalidFields);
    const finiteMetrics: Array<[unknown, string]> = [
      [data.priceToEarningsTtm, 'valuation.priceToEarningsTtm'],
      [data.forwardPriceToEarnings, 'valuation.forwardPriceToEarnings'],
      [data.priceToBook, 'valuation.priceToBook'],
      [data.priceToSalesTtm, 'valuation.priceToSalesTtm'],
      [data.enterpriseValueToEbitdaTtm, 'valuation.enterpriseValueToEbitdaTtm'],
    ];
    for (const [value, field] of finiteMetrics) {
      validFields += countValue(value, field, isFiniteNumber, invalidFields);
    }
    validFields += countValue(
      data.dividendYieldPercent,
      'valuation.dividendYieldPercent',
      isNonNegativeNumber,
      invalidFields,
    );
  }
  return {
    domain: 'valuation',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.valuation,
    invalidFields,
    asOf: isValidDate(data?.asOf) ? data.asOf : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.valuation,
  };
}

function profitabilityCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.profitability;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.periodEnd, 'profitability.periodEnd', isValidDate, invalidFields);
    validFields += countValue(data.revenueTtm, 'profitability.revenueTtm', isNonNegativeNumber, invalidFields);
    const finiteMetrics: Array<[unknown, string]> = [
      [data.operatingIncomeTtm, 'profitability.operatingIncomeTtm'],
      [data.netIncomeTtm, 'profitability.netIncomeTtm'],
      [data.earningsPerShareTtm, 'profitability.earningsPerShareTtm'],
      [data.operatingMarginPercent, 'profitability.operatingMarginPercent'],
      [data.netMarginPercent, 'profitability.netMarginPercent'],
      [data.returnOnEquityPercent, 'profitability.returnOnEquityPercent'],
      [data.returnOnAssetsPercent, 'profitability.returnOnAssetsPercent'],
    ];
    for (const [value, field] of finiteMetrics) {
      validFields += countValue(value, field, isFiniteNumber, invalidFields);
    }
  }
  return {
    domain: 'profitability',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.profitability,
    invalidFields,
    asOf: isValidDate(data?.periodEnd) ? data.periodEnd : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.profitability,
  };
}

function balanceSheetCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.balanceSheet;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.periodEnd, 'balanceSheet.periodEnd', isValidDate, invalidFields);
    const nonNegativeMetrics: Array<[unknown, string]> = [
      [data.totalAssets, 'balanceSheet.totalAssets'],
      [data.totalLiabilities, 'balanceSheet.totalLiabilities'],
      [data.totalDebt, 'balanceSheet.totalDebt'],
      [data.cashAndEquivalents, 'balanceSheet.cashAndEquivalents'],
    ];
    for (const [value, field] of nonNegativeMetrics) {
      validFields += countValue(value, field, isNonNegativeNumber, invalidFields);
    }
    const finiteMetrics: Array<[unknown, string]> = [
      [data.shareholderEquity, 'balanceSheet.shareholderEquity'],
      [data.currentRatio, 'balanceSheet.currentRatio'],
      [data.debtToEquity, 'balanceSheet.debtToEquity'],
    ];
    for (const [value, field] of finiteMetrics) {
      validFields += countValue(value, field, isFiniteNumber, invalidFields);
    }
  }
  return {
    domain: 'balanceSheet',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.balanceSheet,
    invalidFields,
    asOf: isValidDate(data?.periodEnd) ? data.periodEnd : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.balanceSheet,
  };
}

function earningsCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.earnings;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.lastReportDate, 'earnings.lastReportDate', isValidDate, invalidFields);
    validFields += countValue(data.nextReportDate, 'earnings.nextReportDate', isValidDate, invalidFields);
    validFields += countValue(data.fiscalPeriod, 'earnings.fiscalPeriod', isNonEmptyString, invalidFields);
    const finiteMetrics: Array<[unknown, string]> = [
      [data.earningsPerShareActual, 'earnings.earningsPerShareActual'],
      [data.earningsPerShareEstimate, 'earnings.earningsPerShareEstimate'],
      [data.earningsPerShareSurprisePercent, 'earnings.earningsPerShareSurprisePercent'],
      [data.revenueActual, 'earnings.revenueActual'],
      [data.revenueEstimate, 'earnings.revenueEstimate'],
      [data.revenueSurprisePercent, 'earnings.revenueSurprisePercent'],
    ];
    for (const [value, field] of finiteMetrics) {
      validFields += countValue(value, field, isFiniteNumber, invalidFields);
    }
  }
  return {
    domain: 'earnings',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.earnings,
    invalidFields,
    asOf: isValidDate(data?.lastReportDate) ? data.lastReportDate : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.earnings,
  };
}

function isValidCorporateAction(action: EquityCorporateAction): boolean {
  return Boolean(
    action
    && VALID_ACTION_TYPES.has(action.type)
    && isNonEmptyString(action.description)
    && (action.announcedAt == null || isValidDate(action.announcedAt))
    && (action.effectiveDate == null || isValidDate(action.effectiveDate)),
  );
}

function corporateActionsCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.corporateActions;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.asOf, 'corporateActions.asOf', isValidDate, invalidFields);
    if (!Array.isArray(data.items)) {
      invalidFields.push('corporateActions.items');
    } else {
      const invalidItems = data.items.filter((item) => !isValidCorporateAction(item)).length;
      if (invalidItems > 0) {
        invalidFields.push(`corporateActions.items[${invalidItems} invalid]`);
      } else {
        validFields += 1;
      }
    }
  }
  return {
    domain: 'corporateActions',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.corporateActions,
    invalidFields,
    asOf: isValidDate(data?.asOf) ? data.asOf : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.corporateActions,
  };
}

function isValidFiling(filing: EquityFiling): boolean {
  return Boolean(
    filing
    && isNonEmptyString(filing.filingType)
    && isValidDate(filing.filedAt)
    && (filing.periodEnd == null || isValidDate(filing.periodEnd))
    && (filing.accessionNumber == null || isNonEmptyString(filing.accessionNumber))
    && (filing.url == null || isHttpUrl(filing.url)),
  );
}

function filingsCheck(context: NormalizedEquityContext): MutableDomainCheck {
  const data = context.filings;
  const invalidFields: string[] = [];
  let validFields = 0;
  if (data) {
    validFields += countValue(data.asOf, 'filings.asOf', isValidDate, invalidFields);
    if (!Array.isArray(data.items) || data.items.length === 0) {
      invalidFields.push('filings.items');
    } else {
      const invalidItems = data.items.filter((item) => !isValidFiling(item)).length;
      if (invalidItems > 0) {
        invalidFields.push(`filings.items[${invalidItems} invalid]`);
      } else {
        validFields += 1;
      }
    }
  }
  return {
    domain: 'filings',
    present: data != null,
    validFields,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.filings,
    invalidFields,
    asOf: isValidDate(data?.asOf) ? data.asOf : null,
    maxAgeDays: EQUITY_CONTEXT_RULES.freshnessDays.filings,
  };
}

function isValidProvenance(source: EquityProvenance): boolean {
  return Boolean(
    source
    && isNonEmptyString(source.sourceId)
    && isNonEmptyString(source.sourceName)
    && isValidDate(source.retrievedAt)
    && (source.asOf == null || isValidDate(source.asOf))
    && (source.url == null || isHttpUrl(source.url))
    && Array.isArray(source.fields)
    && source.fields.length > 0
    && source.fields.every(isNonEmptyString),
  );
}

function validSources(context: NormalizedEquityContext, now: Date): EquitySourceAssessment[] {
  return context.provenance.filter(isValidProvenance).map((source) => ({
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    retrievedAt: source.retrievedAt,
    asOf: source.asOf ?? null,
    url: source.url ?? null,
    fields: [...source.fields],
    freshness: assessFreshness(source.retrievedAt, EQUITY_CONTEXT_RULES.sourceMaxAgeDays, now),
  }));
}

function provenanceCheck(
  context: NormalizedEquityContext,
  sources: EquitySourceAssessment[],
): MutableDomainCheck {
  const invalidCount = context.provenance.length - sources.length;
  const mostRecent = sources
    .map((source) => source.retrievedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  return {
    domain: 'provenance',
    present: Array.isArray(context.provenance) && context.provenance.length > 0,
    validFields: sources.length,
    requiredFields: EQUITY_CONTEXT_RULES.minimumValidFields.provenance,
    invalidFields: invalidCount > 0 ? [`provenance[${invalidCount} invalid]`] : [],
    asOf: mostRecent,
    maxAgeDays: EQUITY_CONTEXT_RULES.sourceMaxAgeDays,
  };
}

function domainWarning(domain: EquityDomainAssessment): string[] {
  const warnings: string[] = [];
  if (domain.status === 'MISSING') {
    warnings.push(`Cobertura ausente: ${domain.domain}.`);
  } else if (domain.status === 'PARTIAL') {
    warnings.push(
      `Cobertura parcial: ${domain.domain} (${domain.validFields}/${domain.requiredFields} campos mínimos).`,
    );
  } else if (domain.status === 'INVALID') {
    warnings.push(`Datos inválidos: ${domain.domain}.`);
  }
  if (domain.invalidFields.length > 0) {
    warnings.push(`Campos descartados en ${domain.domain}: ${domain.invalidFields.join(', ')}.`);
  }
  if (domain.freshness === 'STALE') {
    warnings.push(`Datos obsoletos: ${domain.domain} excede ${domain.maxAgeDays} días.`);
  } else if (domain.freshness === 'FUTURE') {
    warnings.push(`Fecha futura no verificable: ${domain.domain}.`);
  }
  return warnings;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function analyzeEquityContext(
  context: NormalizedEquityContext,
  options: AnalyzeEquityContextOptions = {},
): EquityContextAnalysis {
  const now = options.now ?? new Date();
  const sources = validSources(context, now);
  const mutableChecks: MutableDomainCheck[] = [
    identityCheck(context),
    marketCapCheck(context),
    valuationCheck(context),
    profitabilityCheck(context),
    balanceSheetCheck(context),
    earningsCheck(context),
    corporateActionsCheck(context),
    filingsCheck(context),
    provenanceCheck(context, sources),
  ];

  const mostRecentSource = sources
    .map((source) => source.retrievedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  mutableChecks[0].asOf = mostRecentSource;
  mutableChecks[0].maxAgeDays = EQUITY_CONTEXT_RULES.sourceMaxAgeDays;

  const domains = mutableChecks.map((check) => finalizeDomain(check, now));
  const domainMap = new Map(domains.map((domain) => [domain.domain, domain]));
  const acceptedInstrument = context.instrument.instrumentType === 'STOCK';
  const identityComplete = domainMap.get('identity')?.status === 'COMPLETE';
  const freshSources = sources.filter((source) => source.freshness === 'FRESH');
  const fundamentalDomains: EquityContextDomain[] = [
    'marketCap', 'valuation', 'profitability', 'balanceSheet', 'earnings',
  ];
  const coreWithData = fundamentalDomains.filter((domain) => {
    const assessment = domainMap.get(domain);
    return assessment && assessment.status !== 'MISSING' && assessment.status !== 'INVALID';
  });
  const freshCoreWithData = coreWithData.filter((domain) => (
    domainMap.get(domain)?.freshness === 'FRESH'
  ));

  const coveragePercent = round(
    domains.reduce((sum, domain) => sum + Math.min(domain.validFields, domain.requiredFields), 0)
      / domains.reduce((sum, domain) => sum + domain.requiredFields, 0)
      * 100,
  );
  const datedDomains = domains.filter((domain) => domain.maxAgeDays !== null);
  const freshnessPercent = datedDomains.length > 0
    ? datedDomains.filter((domain) => domain.freshness === 'FRESH').length / datedDomains.length * 100
    : 0;
  const sourceQualityPercent = sources.length > 0
    ? freshSources.length / sources.length * 100
    : 0;
  const qualityScore = Math.round(
    coveragePercent * 0.7 + freshnessPercent * 0.2 + sourceQualityPercent * 0.1,
  );

  const unavailable = !acceptedInstrument
    || !identityComplete
    || sources.length === 0
    || coreWithData.length === 0;
  const allComplete = domains.every((domain) => domain.status === 'COMPLETE');
  const allCurrent = datedDomains.every((domain) => domain.freshness === 'FRESH');
  const availability: EquityAvailability = unavailable
    ? 'UNAVAILABLE'
    : allComplete && allCurrent
      ? 'AVAILABLE'
      : 'PARTIAL';
  const usableForFundamentalDecision = !unavailable
    && freshSources.length > 0
    && freshCoreWithData.length >= 4
    && qualityScore >= 70;

  const warnings = domains.flatMap(domainWarning);
  const invalidSourceCount = context.provenance.length - sources.length;
  if (!acceptedInstrument) {
    warnings.unshift(
      `Instrumento rechazado: ${context.instrument.instrumentType}; este contrato fundamental exige instrumentType STOCK.`,
    );
  }
  if (!Number.isFinite(now.getTime())) {
    warnings.push('No se pudo evaluar frescura porque la fecha de análisis es inválida.');
  }
  if (invalidSourceCount > 0) {
    warnings.push(`${invalidSourceCount} fuente(s) de procedencia inválida(s) fueron descartadas.`);
  }
  if (sources.length === 0) {
    warnings.push('No hay fuentes válidas que permitan verificar la procedencia de los datos.');
  } else if (freshSources.length === 0) {
    warnings.push('Ninguna fuente de procedencia está vigente.');
  }
  if (!usableForFundamentalDecision) {
    warnings.push('El contexto no cumple la cobertura y frescura mínimas para una decisión fundamental.');
  }

  return {
    kind: 'FUNDAMENTAL_CONTEXT',
    schemaVersion: EQUITY_CONTEXT_RULES.version,
    instrumentType: context.instrument.instrumentType,
    ticker: context.instrument.ticker,
    exchange: context.instrument.exchange,
    currency: context.instrument.currency,
    availability,
    acceptedInstrument,
    operationalSignal: false,
    usableForFundamentalDecision,
    coveragePercent,
    qualityScore,
    domains,
    freshDomains: domains
      .filter((domain) => domain.freshness === 'FRESH')
      .map((domain) => domain.domain),
    staleDomains: domains
      .filter((domain) => domain.freshness === 'STALE')
      .map((domain) => domain.domain),
    unknownFreshnessDomains: domains
      .filter((domain) => domain.freshness === 'UNKNOWN')
      .map((domain) => domain.domain),
    sources,
    warnings,
    assessedAt: Number.isFinite(now.getTime()) ? now.toISOString() : null,
  };
}
