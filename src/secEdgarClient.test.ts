import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS shared production module
import { buildUserAgent, createSecEdgarClient, normalizeSecTicker, padCik } from '../shared/secEdgarClient.cjs';

const TICKERS = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } };
const SUBMISSIONS = {
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000077', '0000320193-26-000070'],
      form: ['8-K', '10-Q'],
      filingDate: ['2026-08-01', '2026-07-25'],
      reportDate: ['2026-08-01', '2026-06-27'],
      primaryDocument: ['aapl-20260801.htm', 'aapl-20260627.htm'],
    },
  },
};

function stubFetch(routes: Record<string, unknown>, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    const body = Object.entries(routes).find(([key]) => String(url).includes(key))?.[1];
    if (body === undefined || status !== 200)
      return { ok: false, status: status === 200 ? 404 : status, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const base = { contact: 'analista@ejemplo.com', minIntervalMs: 0 };

describe('cliente SEC EDGAR', () => {
  it('rellena el CIK a diez dígitos y rechaza los inválidos', () => {
    expect(padCik(320193)).toBe('0000320193');
    expect(padCik('CIK0000320193')).toBe('0000320193');
    expect(() => padCik('abc')).toThrow(/no contiene dígitos/);
    expect(() => padCik('12345678901')).toThrow(/11 dígitos/);
  });

  it('no se construye sin un contacto válido, porque la SEC devolvería 403', () => {
    expect(() => createSecEdgarClient({ contact: '' })).toThrow(/correo de contacto válido/);
    expect(() => createSecEdgarClient({ contact: 'no-es-un-correo' })).toThrow(/correo de contacto válido/);
  });

  it('declara el User-Agent que exige la SEC', () => {
    expect(buildUserAgent('SentinelQuants', 'a@b.com')).toBe('SentinelQuants (a@b.com)');
    const { fetchImpl } = stubFetch({});
    expect(createSecEdgarClient({ ...base, fetchImpl }).userAgent).toBe('SentinelQuants (analista@ejemplo.com)');
  });

  it('resuelve un ticker a su CIK', async () => {
    const { fetchImpl } = stubFetch({ company_tickers: TICKERS });
    const result = await createSecEdgarClient({ ...base, fetchImpl }).resolveTicker('aapl');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.' });
  });

  it('informa el ticker desconocido en vez de inventar un CIK', async () => {
    const { fetchImpl } = stubFetch({ company_tickers: TICKERS });
    const result = await createSecEdgarClient({ ...base, fetchImpl }).resolveTicker('NOEXISTE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNKNOWN_TICKER');
  });

  it('lee las presentaciones y arma la URL del documento', async () => {
    const { fetchImpl } = stubFetch({ submissions: SUBMISSIONS });
    const result = await createSecEdgarClient({ ...base, fetchImpl }).recentFilings(320193);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ form: '8-K', filingDate: '2026-08-01' });
    expect(result.data[0].documentUrl)
      .toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000077/aapl-20260801.htm');
  });

  it('filtra por formulario', async () => {
    const { fetchImpl } = stubFetch({ submissions: SUBMISSIONS });
    const result = await createSecEdgarClient({ ...base, fetchImpl }).recentFilings(320193, ['10-Q']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((filing: { form: string }) => filing.form)).toEqual(['10-Q']);
  });

  it('devuelve el fallo con procedencia cuando la SEC responde error', async () => {
    const { fetchImpl } = stubFetch({ submissions: SUBMISSIONS }, 403);
    const result = await createSecEdgarClient({ ...base, fetchImpl }).recentFilings(320193);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('HTTP_ERROR');
      expect(result.detail).toContain('403');
      expect(result.source).toContain('CIK0000320193.json');
    }
  });

  it('traduce el símbolo del bróker al ticker de la SEC', () => {
    // Sufijo de plaza: se elimina.
    expect(normalizeSecTicker('AAPL.US')).toBe('AAPL');
    expect(normalizeSecTicker('MSFT.NAS')).toBe('MSFT');
    expect(normalizeSecTicker('tsla.us')).toBe('TSLA');
    expect(normalizeSecTicker('NVDA')).toBe('NVDA');
    // Clase de acción: el punto del bróker es guion en la SEC, y no debe perderse la
    // clase, porque BRK y BRK-B no son la misma cotización.
    expect(normalizeSecTicker('BRK.B')).toBe('BRK-B');
    expect(normalizeSecTicker('BF.B')).toBe('BF-B');
    // Combinación de ambas.
    expect(normalizeSecTicker('BRK.B.US')).toBe('BRK-B');
    expect(normalizeSecTicker('')).toBeNull();
    expect(normalizeSecTicker('EUR/USD')).toBeNull();
  });

  it('extrae el ingreso trimestral más reciente del XBRL', () => {
    const { fetchImpl } = stubFetch({});
    const client = createSecEdgarClient({ ...base, fetchImpl });
    const facts = {
      facts: {
        'us-gaap': {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                { end: '2026-03-28', val: 95_359_000_000 },
                { end: '2026-06-27', val: 109_417_000_000 },
                { end: '2025-12-27', val: 88_000_000_000 },
              ],
            },
          },
        },
      },
    };
    // Debe ordenar por fecha de cierre, no confiar en el orden del array.
    expect(client.extractLatestRevenue(facts)).toMatchObject({ value: 109_417_000_000, periodEnd: '2026-06-27' });
  });

  it('devuelve null cuando el emisor no publica ningún concepto de ingresos', () => {
    const { fetchImpl } = stubFetch({});
    const client = createSecEdgarClient({ ...base, fetchImpl });
    // Ausencia de dato, nunca cero: un cero se leería como "no facturó".
    expect(client.extractLatestRevenue({ facts: { 'us-gaap': {} } })).toBeNull();
    expect(client.extractLatestRevenue({})).toBeNull();
  });

  it('cachea el directorio de tickers en vez de bajar 796 KB por consulta', async () => {
    const { fetchImpl, calls } = stubFetch({ company_tickers: TICKERS });
    let clock = 0;
    const client = createSecEdgarClient({
      contact: 'analista@ejemplo.com', fetchImpl, minIntervalMs: 0,
      now: () => clock, directoryTtlMs: 1000,
    });
    await client.resolveTicker('AAPL');
    await client.resolveTicker('AAPL');
    await client.resolveTicker('AAPL');
    expect(calls.filter(url => url.includes('company_tickers'))).toHaveLength(1);

    // Pasado el TTL vuelve a pedirlo: el directorio cambia a diario.
    clock = 1001;
    await client.resolveTicker('AAPL');
    expect(calls.filter(url => url.includes('company_tickers'))).toHaveLength(2);
  });

  it('un fallo de red no envenena la caché del directorio', async () => {
    const { fetchImpl, calls } = stubFetch({ company_tickers: TICKERS }, 503);
    const client = createSecEdgarClient({ ...base, fetchImpl });
    expect((await client.resolveTicker('AAPL')).ok).toBe(false);
    expect((await client.resolveTicker('AAPL')).ok).toBe(false);
    // Debe reintentar, no quedarse con un fallo cacheado.
    expect(calls.filter(url => url.includes('company_tickers'))).toHaveLength(2);
  });

  it('espacia las solicitudes para respetar el límite de la SEC', async () => {
    const { fetchImpl } = stubFetch({ company_tickers: TICKERS });
    const waits: number[] = [];
    let clock = 0;
    const client = createSecEdgarClient({
      contact: 'analista@ejemplo.com',
      fetchImpl,
      minIntervalMs: 110,
      // Sin caché, para que ambas llamadas lleguen realmente a la red y se pueda
      // observar el espaciado que exige la SEC.
      directoryTtlMs: 0,
      now: () => clock,
      sleep: async (ms: number) => { waits.push(ms); clock += ms; },
    });
    await client.resolveTicker('AAPL');
    await client.resolveTicker('AAPL');
    expect(waits.at(-1)).toBe(110);
  });
});
