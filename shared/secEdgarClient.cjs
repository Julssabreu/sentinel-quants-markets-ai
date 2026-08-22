'use strict';
/**
 * Cliente de solo lectura para SEC EDGAR.
 *
 * Vive en `shared/` porque el proceso principal es quien hace la red —igual que
 * noticias, macro y TradingView— y las pruebas de `src/` consumen este mismo archivo.
 * Duplicarlo en TypeScript habría creado el par divergente que esta auditoría
 * justamente señala en otros módulos.
 *
 * Requisitos que la SEC impone y que este cliente respeta:
 *   - `User-Agent` con un contacto real; sin él la SEC responde 403.
 *   - Máximo 10 solicitudes por segundo.
 *   - El CIK viaja siempre con 10 dígitos y relleno de ceros.
 *
 * El contacto no tiene valor por defecto a propósito: es un dato personal que sale
 * hacia un servicio externo en cada consulta, así que lo aporta quien construye el
 * cliente. Sin contacto no hay cliente.
 */

const SEC_EDGAR_CLIENT_VERSION = '1.0.0';

const TICKER_DIRECTORY_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_URL = 'https://data.sec.gov/submissions';
const COMPANY_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts';

/** La SEC permite 10 solicitudes por segundo; dejamos margen. */
const DEFAULT_MIN_INTERVAL_MS = 110;

/**
 * El directorio de tickers pesa ~796 KB y la SEC lo actualiza como mucho una vez al
 * día. Sin caché, cada consulta de una acción distinta lo descargaba entero.
 */
const DEFAULT_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Concepto XBRL de ingresos que declaran hoy la mayoría de emisores. */
const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
];

const CONTACT_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/** Sufijos de plaza que los brókers añaden al símbolo y la SEC no reconoce. */
const BROKER_EXCHANGE_SUFFIXES = new Set(['US', 'USA', 'NAS', 'NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'OTC', 'CFD']);

/**
 * Traduce el símbolo del bróker al ticker que lista la SEC.
 *
 * Dos convenciones chocan: el bróker escribe `AAPL.US` (plaza) y `BRK.B` (clase de
 * acción) con el mismo separador, mientras la SEC usa `AAPL` y `BRK-B`. Por eso solo
 * se elimina el último segmento cuando es una plaza conocida; cualquier otro punto se
 * interpreta como clase de acción y pasa a guion.
 *
 * Es una heurística: un sufijo de plaza no listado aquí sobrevivirá como clase y la
 * consulta devolverá `UNKNOWN_TICKER`, que es un fallo visible y no un dato inventado.
 */
function normalizeSecTicker(symbol) {
  const raw = String(symbol ?? '').trim().toUpperCase();
  if (!raw) return null;
  const parts = raw.split('.').filter(Boolean);
  if (!parts.length) return null;
  if (parts.length > 1 && BROKER_EXCHANGE_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  const normalized = parts.join('-');
  return /^[A-Z][A-Z\-]{0,9}$/.test(normalized) ? normalized : null;
}

function padCik(cik) {
  const digits = String(cik).replace(/\D/g, '');
  if (!digits) throw new Error('CIK inválido: no contiene dígitos.');
  if (digits.length > 10) throw new Error(`CIK inválido: ${digits.length} dígitos.`);
  return digits.padStart(10, '0');
}

function buildUserAgent(appName, contact) {
  return `${appName} (${contact})`;
}

function createSecEdgarClient(config = {}) {
  const contact = String(config.contact ?? '').trim();
  if (!CONTACT_PATTERN.test(contact))
    throw new Error('SEC EDGAR exige un correo de contacto válido en el User-Agent; configúralo antes de consultar.');

  const appName = config.appName ?? 'SentinelQuants';
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function')
    throw new Error('No hay implementación de fetch disponible para SEC EDGAR.');

  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const directoryTtlMs = config.directoryTtlMs ?? DEFAULT_DIRECTORY_TTL_MS;
  const headers = { 'User-Agent': buildUserAgent(appName, contact), 'Accept-Encoding': 'gzip, deflate' };

  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let queue = Promise.resolve();

  /** Serializa y espacia las solicitudes para no exceder el límite de la SEC. */
  function throttled(task) {
    const run = queue.then(async () => {
      const waitMs = lastRequestAt + minIntervalMs - now();
      if (waitMs > 0) await sleep(waitMs);
      lastRequestAt = now();
      return task();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function getJson(url) {
    try {
      const response = await throttled(() => doFetch(url, { headers }));
      if (!response.ok)
        return { ok: false, reason: 'HTTP_ERROR', detail: `HTTP ${response.status} en ${url}`, source: url };
      try {
        return { ok: true, data: await response.json(), retrievedAt: new Date(now()).toISOString(), source: url };
      } catch (error) {
        return { ok: false, reason: 'MALFORMED_RESPONSE', detail: String(error), source: url };
      }
    } catch (error) {
      return { ok: false, reason: 'NETWORK_ERROR', detail: String(error), source: url };
    }
  }

  /**
   * Directorio de tickers cacheado en memoria: se descarga una vez por TTL en lugar
   * de en cada consulta. Un fallo no envenena la caché.
   */
  let directoryCache = null;
  async function loadDirectory() {
    if (directoryCache && now() - directoryCache.at < directoryTtlMs)
      return { ok: true, data: directoryCache.data, retrievedAt: directoryCache.retrievedAt, source: TICKER_DIRECTORY_URL, cached: true };
    const response = await getJson(TICKER_DIRECTORY_URL);
    if (response.ok) directoryCache = { data: response.data, at: now(), retrievedAt: response.retrievedAt };
    return response;
  }

  /** Resuelve un ticker a su CIK usando el directorio oficial de la SEC. */
  async function resolveTicker(ticker) {
    const wanted = String(ticker ?? '').trim().toUpperCase();
    if (!wanted)
      return { ok: false, reason: 'UNKNOWN_TICKER', detail: 'Ticker vacío.', source: TICKER_DIRECTORY_URL };
    const directory = await loadDirectory();
    if (!directory.ok) return directory;
    const entry = Object.values(directory.data ?? {})
      .find(item => String(item?.ticker ?? '').toUpperCase() === wanted);
    if (!entry)
      return { ok: false, reason: 'UNKNOWN_TICKER', detail: `La SEC no lista el ticker ${wanted}.`, source: TICKER_DIRECTORY_URL };
    return {
      ok: true,
      data: { cik: padCik(entry.cik_str), ticker: wanted, name: entry.title },
      retrievedAt: directory.retrievedAt,
      source: TICKER_DIRECTORY_URL,
    };
  }

  /** Devuelve las presentaciones recientes, opcionalmente filtradas por formulario. */
  async function recentFilings(cik, forms) {
    const padded = padCik(cik);
    const url = `${SUBMISSIONS_URL}/CIK${padded}.json`;
    const response = await getJson(url);
    if (!response.ok) return response;
    const recent = response.data && response.data.filings && response.data.filings.recent;
    if (!recent || !Array.isArray(recent.accessionNumber))
      return { ok: false, reason: 'MALFORMED_RESPONSE', detail: 'La respuesta no contiene filings.recent.', source: url };
    const wanted = forms && forms.length ? new Set(forms.map(form => String(form).toUpperCase())) : null;
    const at = (field, index) => (Array.isArray(recent[field]) ? recent[field][index] : undefined);
    const filings = [];
    for (let index = 0; index < recent.accessionNumber.length; index++) {
      const form = String(at('form', index) ?? '');
      if (wanted && !wanted.has(form.toUpperCase())) continue;
      const accessionNumber = String(at('accessionNumber', index) ?? '');
      const primaryDocument = String(at('primaryDocument', index) ?? '');
      const reportDate = String(at('reportDate', index) ?? '');
      filings.push({
        accessionNumber,
        form,
        filingDate: String(at('filingDate', index) ?? ''),
        reportDate: reportDate || null,
        primaryDocument,
        documentUrl: `https://www.sec.gov/Archives/edgar/data/${Number(padded)}/${accessionNumber.replace(/-/g, '')}/${primaryDocument}`,
      });
    }
    return { ok: true, data: filings, retrievedAt: response.retrievedAt, source: url };
  }

  /** Hechos XBRL declarados por la empresa. */
  async function companyFacts(cik) {
    return getJson(`${COMPANY_FACTS_URL}/CIK${padCik(cik)}.json`);
  }

  /**
   * Ingreso trimestral más reciente declarado en XBRL. Devuelve `null` cuando el
   * emisor no publica ninguno de los conceptos conocidos: es un dato ausente, no cero.
   */
  function extractLatestRevenue(facts) {
    const gaap = facts && facts.facts && facts.facts['us-gaap'];
    if (!gaap) return null;
    for (const concept of REVENUE_CONCEPTS) {
      const usd = gaap[concept] && gaap[concept].units && gaap[concept].units.USD;
      if (!Array.isArray(usd) || !usd.length) continue;
      const quarterly = usd
        .filter(item => item && Number.isFinite(item.val) && typeof item.end === 'string')
        .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
      const latest = quarterly[quarterly.length - 1];
      if (latest) return { value: latest.val, periodEnd: latest.end, concept };
    }
    return null;
  }

  return {
    version: SEC_EDGAR_CLIENT_VERSION,
    userAgent: headers['User-Agent'],
    resolveTicker,
    recentFilings,
    companyFacts,
    extractLatestRevenue,
  };
}

module.exports = {
  SEC_EDGAR_CLIENT_VERSION,
  REVENUE_CONCEPTS,
  BROKER_EXCHANGE_SUFFIXES,
  padCik,
  buildUserAgent,
  normalizeSecTicker,
  createSecEdgarClient,
};
