const { app, BrowserWindow, shell, ipcMain: electronIpcMain, Tray, Menu, nativeImage, safeStorage, powerMonitor, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { createHash, randomUUID } = require('crypto');
const { createQuantResearchStore } = require('../shared/quantResearchStore.cjs');
const { createSentinelOperationalStore } = require('../shared/sentinelOperationalStore.cjs');
const { createOperationalHealthScheduler } = require('../shared/operationalHealthScheduler.cjs');
const { buildMt5DatasetBundle } = require('../shared/quantDatasetImport.cjs');
const { discoverMt5CsvBundles, loadMt5CsvBundle } = require('../shared/mt5CsvHistoricalImport.cjs');
const { evaluatePlan, selectFairEvaluationBatch } = require('../shared/outcomeEvaluator.cjs');
const atomicParser = require('../shared/atomicMt5Parser.cjs');
const { ANTHROPIC_REVIEW_MODEL, isExternalReviewEligible, externalReviewVerdict } = require('../shared/modelReviewPolicy.cjs');
const { prepareHistoryDraft, trustedReviewRecord } = require('../shared/backendGuard.cjs');
const { createEvidenceLedger, stableJson } = require('../shared/evidenceLedger.cjs');
const { createPersistentLogger } = require('../shared/persistentLog.cjs');
const { isTrustedIpcEvent } = require('../shared/ipcTrust.cjs');
const { createSecEdgarClient, normalizeSecTicker } = require('../shared/secEdgarClient.cjs');
const { createMassiveClient, lastTwoSessionDates, selectAdaptiveUniverse } = require('../shared/massiveClient.cjs');
const { composeDailyReportText } = require('../shared/dailyReportComposer.cjs');
const { buildDailyReportHtml } = require('../shared/dailyReportHtml.cjs');
const { createDailyClockScheduler } = require('../shared/dailyClockScheduler.cjs');
const { canonicalSignalFingerprint, sameSignalIdentity, parseLegacyRetryIdentity } = require('../shared/signalIdentity.cjs');
const { runTrustedQuantBacktest, runTrustedQuantStage, runTrustedParameterStability, validateTrustedQuantPreparation } = require('../shared/quantBackendRunner.cjs');
const { upsertAlertCandidates } = require('../shared/alertStorePolicy.cjs');
const { createCryptoFlowWindow, addTrade, addLiquidation, cryptoFlowWindowSnapshot } = require('../shared/cryptoFlowWindow.cjs');
const { classifySignalRetry, abandonStaleSignal } = require('../shared/signalDeliveryPolicy.cjs');
const { signalTimeframes, defaultSignalNotifier, normalizeSignalNotifier } = require('../shared/signalNotifierPolicy.cjs');
const { evaluateAutonomousRuntimeHeartbeat, evaluateRuntimeJournal } = require('../shared/autonomousRuntimeHealth.cjs');

const REQUEST_TIMEOUT_MS = 10000;
const applicationStartedAt=Date.now();
const sentinelUserAgent=()=>`Sentinel-Markets-AI/${app.getVersion()}`;
const cryptoFlowMonitors = new Map();
let signalDeliveryQueue=Promise.resolve();
let tray=null,quitting=false,signalNotifierCache=null,tradingViewConfigCache=null,tradingViewVixCache=null,operationalHealthScheduler=null,operationalHealthRefreshPromise=null,evidenceLedger=null,persistentLogger=null,signalRetryTimer=null;
const hasSingleInstanceLock=app.requestSingleInstanceLock();
if(!hasSingleInstanceLock)app.quit();
app.on('second-instance',()=>{const win=BrowserWindow.getAllWindows()[0];if(win){win.show();win.focus()}});
function assertTrustedIpc(event){
  const trusted=isTrustedIpcEvent(event,{
    browserWindows:BrowserWindow.getAllWindows(),
    packagedEntry:path.join(__dirname,'..','dist','index.html'),
    allowDevServer:!app.isPackaged&&process.env.SENTINEL_LOCAL_BUILD!=='1',
    devPort:5173,
  });
  if(!trusted)throw new Error('Origen IPC no autorizado.');
}
const ipcMain={handle(channel,listener){return electronIpcMain.handle(channel,(event,...args)=>{assertTrustedIpc(event);return listener(event,...args)})}};
function quantResearchStore(){return createQuantResearchStore(path.join(app.getPath('userData'),'quant-research'))}
function sentinelOperationalStore(){return createSentinelOperationalStore(path.join(app.getPath('userData'),'sentinel-operational'))}
function ledgerStore(){if(!evidenceLedger)evidenceLedger=createEvidenceLedger(app.getPath('userData'),{maxActiveBytes:32*1024*1024,onEvent:event=>void persistentLogger?.write(event.level,event.event,event).catch(()=>{})});return evidenceLedger}
function appendLedger(kind,payload){return ledgerStore().append(kind,payload)}
function verifyLedger(options){return ledgerStore().verify(options)}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': sentinelUserAgent() }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent':sentinelUserAgent() } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timeout); }
}

async function loadMarketSnapshot() {
  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled([
    fetchJson('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT'),
    fetchJson('https://api.frankfurter.dev/v2/rate/EUR/USD?providers=ECB')
  ]);

  const instruments = [];
  const errors = [];
  if (results[0].status === 'fulfilled') {
    const item = results[0].value;
    instruments.push({
      symbol: 'BTC/USD', price: Number(item.lastPrice), change: Number(item.priceChangePercent),
      source: 'Binance Spot', sourceUrl: 'https://data-api.binance.vision',
      observedAt: new Date(Number(item.closeTime)).toISOString(), freshness: 'tiempo real aproximado'
    });
  } else errors.push(`Binance: ${results[0].reason?.message || 'sin respuesta'}`);

  if (results[1].status === 'fulfilled') {
    const item = results[1].value;
    instruments.push({
      symbol: 'EUR/USD', price: Number(item.rate), change: null,
      source: 'BCE via Frankfurter', sourceUrl: 'https://frankfurter.dev/providers/ecb/',
      observedAt: `${item.date}T16:00:00.000Z`, freshness: 'referencia diaria; no apta para entrada intradia'
    });
  } else errors.push(`BCE/Frankfurter: ${results[1].reason?.message || 'sin respuesta'}`);

  return { checkedAt, instruments, errors };
}

ipcMain.handle('market:snapshot', async () => {const value=await loadMarketSnapshot();const evidence=await appendLedger('MARKET_SNAPSHOT',value);return{...value,evidenceHash:evidence.hash}});

async function loadMacroSnapshot() {
  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled([
    fetchJson('https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json'),
    fetchJson('https://api.frankfurter.dev/v2/rate/EUR/USD?providers=ECB'),
    fetchJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json'),
    fetchJson('https://api.bls.gov/publicAPI/v2/timeseries/data/CUSR0000SA0'),
    fetchJson('https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000'),
    fetchJson('https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001'),
    fetchText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${new Date().getUTCFullYear()}`)
  ]);
  const indicators = [];
  const events = [];
  const errors = [];
  if (results[0].status === 'fulfilled') {
    const row = results[0].value?.refRates?.[0];
    if (row) indicators.push({ id:'SOFR', name:'SOFR', value:Number(row.percentRate), unit:'%', period:row.effectiveDate,
      observedAt:`${row.effectiveDate}T12:00:00.000Z`, source:'Federal Reserve Bank of New York',
      sourceUrl:'https://markets.newyorkfed.org/read?productCode=50&eventCodes=525&startDt=&endDt=&sort=postDt:-1,eventCode:1&format=csv',
      category:'Tasas', frequency:'diaria', interpretation:'Coste de financiación garantizada en dólares.' });
    else errors.push('New York Fed: respuesta sin SOFR.');
  } else errors.push(`New York Fed: ${results[0].reason?.message || 'sin respuesta'}`);
  if (results[1].status === 'fulfilled') {
    const row = results[1].value;
    indicators.push({ id:'ECB_EURUSD', name:'EUR/USD de referencia BCE', value:Number(row.rate), unit:'USD por EUR', period:row.date,
      observedAt:`${row.date}T16:00:00.000Z`, source:'BCE vía Frankfurter', sourceUrl:'https://frankfurter.dev/providers/ecb/',
      category:'Divisas', frequency:'diaria', interpretation:'Referencia oficial diaria; no es una cotización operativa.' });
  } else errors.push(`BCE: ${results[1].reason?.message || 'sin respuesta'}`);
  if (results[2].status === 'fulfilled' && Array.isArray(results[2].value)) {
    const now = Date.now();
    for (const row of results[2].value) {
      const timestamp = new Date(row.date).getTime();
      if (Number.isFinite(timestamp) && timestamp >= now - 86400000) events.push({
        id:`FF-${row.country}-${row.date}-${row.title}`, title:row.title, currency:row.country,
        impact:row.impact, scheduledAt:new Date(timestamp).toISOString(), forecast:row.forecast || null,
        previous:row.previous || null, source:'Forex Factory', sourceUrl:'https://www.forexfactory.com/calendar',
        quality:'secondary-calendar'
      });
    }
    events.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt));
  } else errors.push(`Forex Factory: ${results[2].reason?.message || 'respuesta inválida'}`);
  const blsDefinitions = [
    { index:3, id:'US_CPI', name:'IPC estadounidense ajustado', unit:'índice', category:'Inflación', interpretation:'Nivel general de precios para consumidores urbanos.', series:'CUSR0000SA0' },
    { index:4, id:'US_UNEMPLOYMENT', name:'Desempleo de Estados Unidos', unit:'%', category:'Empleo', interpretation:'Tasa de desempleo civil ajustada estacionalmente.', series:'LNS14000000' },
    { index:5, id:'US_PAYROLLS', name:'Nóminas no agrícolas', unit:'miles', category:'Empleo', interpretation:'Nivel de empleo no agrícola; analizar cambios mensuales, no el nivel aislado.', series:'CES0000000001' }
  ];
  for (const definition of blsDefinitions) {
    const result = results[definition.index];
    if (result?.status === 'fulfilled') {
      const point = result.value?.Results?.series?.[0]?.data?.[0];
      if (point) indicators.push({ id:definition.id, name:definition.name, value:Number(point.value), unit:definition.unit,
        period:`${point.periodName} ${point.year}`, observedAt:`${point.year}-${String(new Date(`${point.periodName} 1, ${point.year}`).getMonth()+1).padStart(2,'0')}-01T12:00:00.000Z`,
        source:'U.S. Bureau of Labor Statistics', sourceUrl:`https://data.bls.gov/timeseries/${definition.series}`,
        category:definition.category, frequency:'mensual', interpretation:definition.interpretation });
      else errors.push(`BLS ${definition.series}: respuesta sin datos.`);
    } else errors.push(`BLS ${definition.series}: ${result?.reason?.message || 'sin respuesta'}`);
  }
  let yieldCurve = null;
  if (results[6]?.status === 'fulfilled') {
    const entries = results[6].value.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const latest = entries.at(-1) || '';
    const value = key => Number((latest.match(new RegExp(`<d:${key}[^>]*>([^<]+)<\\/d:${key}>`)) || [])[1]);
    const date = (latest.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/) || [])[1];
    const points = { y2:value('BC_2YEAR'), y5:value('BC_5YEAR'), y10:value('BC_10YEAR'), y30:value('BC_30YEAR') };
    if (date && Object.values(points).every(Number.isFinite)) yieldCurve = { date, ...points,
      spread10y2y:Number((points.y10-points.y2).toFixed(2)), shape:points.y10-points.y2<0?'INVERTIDA':points.y10-points.y2<0.35?'PLANA':'NORMAL',
      source:'U.S. Department of the Treasury', sourceUrl:'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' };
    else errors.push('Tesoro de EE. UU.: no fue posible interpretar la curva.');
  } else errors.push(`Tesoro de EE. UU.: ${results[6]?.reason?.message || 'sin respuesta'}`);
  return { checkedAt, indicators, events:events.slice(0,80), yieldCurve, errors };
}

ipcMain.handle('macro:snapshot', async () => {const value=await loadMacroSnapshot();const evidence=await appendLedger('MACRO_SNAPSHOT',value);return{...value,evidenceHash:evidence.hash}});

// SEC EDGAR: fuente primaria de presentaciones y fundamentales para acciones y ETF.
// El contacto va en el User-Agent porque la SEC responde 403 sin él, y queda en un
// solo sitio para poder editarse sin buscarlo por el código.
// El contacto es un dato personal que viaja a la SEC en cada consulta: se guarda como
// ajuste editable, no incrustado en el código.
function secEdgarConfigPath(){return path.join(app.getPath('userData'),'sentinel-sec-edgar.json')}
const defaultSecEdgarConfig={schemaVersion:1,contact:'j_c_a34@hotmail.com'};
function normalizeSecEdgarConfig(value={}){const contact=String(value.contact??'').trim();return{schemaVersion:1,contact:/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(contact)?contact:''}}
let secEdgarConfigCache=null;
async function readSecEdgarConfig(){
  if(secEdgarConfigCache)return secEdgarConfigCache;
  try{secEdgarConfigCache=normalizeSecEdgarConfig(JSON.parse(await fs.readFile(secEdgarConfigPath(),'utf8')))}
  catch(error){if(error.code!=='ENOENT')throw error;secEdgarConfigCache={...defaultSecEdgarConfig}}
  return secEdgarConfigCache;
}
async function writeSecEdgarConfig(value){
  const normalized=normalizeSecEdgarConfig(value);
  if(!normalized.contact)throw new Error('La SEC exige un correo de contacto válido; sin él responde 403.');
  const target=secEdgarConfigPath(),temporary=`${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(temporary,JSON.stringify(normalized,null,2),'utf8');
  await fs.rename(temporary,target);
  secEdgarConfigCache=normalized;secEdgarClientInstance=null;secEdgarClientContact='';
  return normalized;
}
// Massive (antes Polygon.io): datos de acciones de EE. UU. con horario extendido, el
// hueco que MT5 no cubre porque su feed es de CFDs y solo trae sesión regular.
// La clave se cifra con el almacenamiento seguro de Windows, igual que el token de
// TradingView, y nunca se devuelve al renderer — solo se informa si existe o no.
function massiveConfigPath(){return path.join(app.getPath('userData'),'sentinel-massive.json')}
const defaultMassiveConfig={schemaVersion:1,enabled:false,apiKeyEncrypted:''};
function publicMassiveConfig(value){return{schemaVersion:1,enabled:value.enabled===true,hasApiKey:Boolean(value.apiKeyEncrypted)}}
let massiveConfigCache=null;
async function readMassiveConfig(){
  if(massiveConfigCache)return massiveConfigCache;
  try{
    const value=JSON.parse(await fs.readFile(massiveConfigPath(),'utf8'));
    massiveConfigCache={schemaVersion:1,enabled:value.enabled===true,apiKeyEncrypted:String(value.apiKeyEncrypted||'')};
  }catch(error){if(error.code!=='ENOENT')throw error;massiveConfigCache={...defaultMassiveConfig}}
  return massiveConfigCache;
}
async function writeMassiveConfig(value={}){
  const previous=await readMassiveConfig(),apiKey=String(value.apiKey||'').trim();
  const normalized={
    schemaVersion:1,
    enabled:value.enabled===true,
    apiKeyEncrypted:value.clearApiKey===true?'':(apiKey?encryptLocalSecret(apiKey):previous.apiKeyEncrypted),
  };
  if(normalized.enabled&&!normalized.apiKeyEncrypted)throw new Error('Massive requiere una clave de API para activarse.');
  const target=massiveConfigPath(),temporary=`${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(temporary,JSON.stringify(normalized,null,2),'utf8');
  await fs.rename(temporary,target);
  massiveConfigCache=normalized;massiveClientInstance=null;
  return publicMassiveConfig(normalized);
}
let massiveClientInstance=null;
async function massiveClient(){
  const config=await readMassiveConfig();
  if(!config.enabled)return null;
  const apiKey=decryptLocalSecret(config.apiKeyEncrypted);
  if(!apiKey)throw new Error('No se pudo descifrar la clave de Massive; vuelve a introducirla.');
  if(!massiveClientInstance)massiveClientInstance=createMassiveClient({apiKey});
  return massiveClientInstance;
}
ipcMain.handle('massive:get-config',async()=>({ok:true,config:publicMassiveConfig(await readMassiveConfig())}));
ipcMain.handle('massive:save-config',async(_event,value)=>({ok:true,config:await writeMassiveConfig(value)}));
ipcMain.handle('massive:test',async()=>{
  const client=await massiveClient();
  if(!client)throw new Error('Activa Massive y guarda la clave antes de probar.');
  const{previousSessionDate,currentSessionDate}=lastTwoSessionDates(new Date());
  const snapshot=await client.extendedHoursSnapshot('AAPL',previousSessionDate,currentSessionDate);
  if(snapshot.error)throw new Error(`Massive respondió: ${snapshot.error}`);
  return{ok:true,ticker:snapshot.ticker,previousClose:snapshot.previousClose,
    premarketBars:snapshot.premarket?.bars??0,afterHoursBars:snapshot.afterHours?.bars??0};
});

let secEdgarClientInstance=null,secEdgarClientContact='';
async function secEdgar(){
  const {contact}=await readSecEdgarConfig();
  if(!contact)throw new Error('Configura el correo de contacto de SEC EDGAR antes de consultar.');
  // Reconstruye el cliente si el contacto cambió: el User-Agent quedaría obsoleto.
  if(!secEdgarClientInstance||secEdgarClientContact!==contact){
    secEdgarClientInstance=createSecEdgarClient({contact,appName:'SentinelQuants'});
    secEdgarClientContact=contact;
  }
  return secEdgarClientInstance;
}
ipcMain.handle('sec:config-get',async()=>({ok:true,config:await readSecEdgarConfig()}));
ipcMain.handle('sec:config-save',async(_event,value)=>({ok:true,config:await writeSecEdgarConfig(value)}));
// El renderer envía el símbolo del bróker (AAPL.US, BRK.B); la traducción al ticker de
// la SEC ocurre aquí, en un único punto. Extraída como función nombrada porque tanto el
// handler IPC como el informe diario programado necesitan el mismo snapshot.
async function fetchSecCompanySnapshot(ticker){
  const raw=String(ticker||'').trim().toUpperCase();
  const symbol=normalizeSecTicker(raw);
  const empty={ticker:symbol||raw,companyName:null,filings:[],latestRevenue:null,retrievedAt:null,error:null};
  if(!symbol)return{...empty,error:`El símbolo ${raw||'vacío'} no corresponde a un ticker de la SEC.`};
  let client;
  try{client=await secEdgar()}
  catch(cause){return{...empty,error:cause instanceof Error?cause.message:String(cause)}}
  const company=await client.resolveTicker(symbol);
  if(!company.ok)return{...empty,error:company.detail};
  const [filings,facts]=[await client.recentFilings(company.data.cik,['8-K','10-Q','10-K']),await client.companyFacts(company.data.cik)];
  const snapshot={
    ticker:symbol,companyName:company.data.name,
    filings:filings.ok?filings.data.slice(0,20).map(item=>({form:item.form,filingDate:item.filingDate,documentUrl:item.documentUrl})):[],
    latestRevenue:facts.ok?client.extractLatestRevenue(facts.data):null,
    retrievedAt:new Date().toISOString(),
    // Un fallo se declara; nunca se sustituye por una lista vacía silenciosa.
    error:filings.ok?(facts.ok?null:facts.detail):filings.detail,
  };
  await appendLedger('SEC_EDGAR_SNAPSHOT',{ticker:symbol,cik:company.data.cik,filings:snapshot.filings.length,hasRevenue:Boolean(snapshot.latestRevenue)});
  return snapshot;
}
ipcMain.handle('sec:company-snapshot',async(_event,ticker)=>fetchSecCompanySnapshot(ticker));

// Informe diario: escáner + EDGAR + VWAP/opening range compuestos en texto y enviados
// por WhatsApp a las 9:00 AST. República Dominicana no observa horario de verano, así
// que la hora objetivo es siempre 13:00 UTC — ver shared/dailyClockScheduler.cjs.
const DAILY_REPORT_UTC_HOUR=13,DAILY_REPORT_UTC_MINUTE=0;
/** Proxies de índice: son ETF, se consultan igual que una acción. */
const DAILY_REPORT_INDEX_PROXIES=['SPY','QQQ','DIA','IWM'];
/** Presupuesto de llamadas del plan gratuito: ver comentario en buildDailyReportAssets. */
const DAILY_REPORT_MAX_MOVERS=8,DAILY_REPORT_MAX_CATALYSTS=4,DAILY_REPORT_MAX_PREVIEW=3;
function dailyReportConfigPath(){return path.join(app.getPath('userData'),'sentinel-daily-report.json')}
const defaultDailyReportConfig={schemaVersion:1,enabled:false};
function normalizeDailyReportConfig(value={}){return{schemaVersion:1,enabled:value.enabled===true}}
let dailyReportConfigCache=null;
async function readDailyReportConfig(){
  if(dailyReportConfigCache)return dailyReportConfigCache;
  try{dailyReportConfigCache=normalizeDailyReportConfig(JSON.parse(await fs.readFile(dailyReportConfigPath(),'utf8')))}
  catch(error){if(error.code!=='ENOENT')throw error;dailyReportConfigCache={...defaultDailyReportConfig}}
  return dailyReportConfigCache;
}
async function writeDailyReportConfig(value){
  const normalized=normalizeDailyReportConfig(value),target=dailyReportConfigPath(),temporary=`${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(temporary,JSON.stringify(normalized,null,2),'utf8');
  await fs.rename(temporary,target);
  dailyReportConfigCache=normalized;
  if(dailyReportScheduler)normalized.enabled?dailyReportScheduler.start():dailyReportScheduler.stop();
  return normalized;
}

// Solo acciones de EE. UU.: el informe dejó de cubrir forex/cripto/CFD a pedido
// explícito. El feed MT5 es de CFDs y solo entrega sesión regular — sin premercado ni
// after-hours reales, así que esa franja se declara no disponible en vez de
// aproximarla. Requiere decidir y conectar un bróker de horario extendido
// (TradeStation o Interactive Brokers); mientras tanto extendedHoursSource.connected
// se queda en false.
/**
 * Reúne todo lo que consume el informe. El universo de acciones ya no sale del escáner
 * MT5: ese feed son CFDs, no acciones de EE. UU. Massive entrega el mercado completo
 * (~12.500 símbolos) en una sola llamada, que es la fuente correcta para este informe.
 *
 * Presupuesto de llamadas con el plan gratuito (5 por minuto), en serie porque el
 * cliente las espacia solo: 1 estado + 1 feriados + 1 mercado completo + 4 índices +
 * 8 movers + 1 noticias ≈ 16 llamadas, unos 3,5 minutos. Aceptable para una tarea
 * diaria; imposible si se intentara escanear los 12.500 símbolos uno a uno.
 */
async function buildDailyReportAssets(){
  const [macro,vix]=await Promise.all([
    loadMacroSnapshot().catch(()=>null),
    getTradingViewVixContext(false).catch(()=>null),
  ]);
  const vixSummary=vix?.ok&&vix.snapshot?{value:vix.snapshot.value,observedAt:vix.snapshot.observedAt,source:'TradingView / Cloudflare'}:null;
  const now=new Date(),{previousSessionDate,currentSessionDate}=lastTwoSessionDates(now);

  let extendedHoursSource={connected:false,brokerName:null},
      indices=[],movers=[],news=[],marketHolidays=[],marketStatus=null,catalysts=[];

  try{
    const client=await massiveClient();
    if(client){
      extendedHoursSource={connected:true,brokerName:'Massive'};

      const status=await client.marketStatus();
      if(status.ok)marketStatus=status.data;
      const holidays=await client.upcomingMarketHolidays();
      if(holidays.ok)marketHolidays=holidays.data;

      // Índices de referencia: son ETF, así que se consultan como cualquier acción.
      for(const ticker of DAILY_REPORT_INDEX_PROXIES){
        const snapshot=await client.extendedHoursSnapshot(ticker,previousSessionDate,currentSessionDate);
        indices.push({
          ticker,
          previousRegular:Number.isFinite(snapshot.previousClose)?{last:snapshot.previousClose,changePercent:snapshot.previousRegularChangePercent}:null,
          premarket:snapshot.premarket,
          afterHours:snapshot.afterHours,
          error:snapshot.error,
        });
      }

      // Universo del día: mercado completo filtrado por liquidez y ordenado por
      // movimiento absoluto. Excluye los propios índices para no duplicarlos.
      const grouped=await client.groupedDaily(previousSessionDate);
      const universe=grouped.ok
        ? selectAdaptiveUniverse(grouped.data,{limit:DAILY_REPORT_MAX_MOVERS,exclude:DAILY_REPORT_INDEX_PROXIES})
        : [];
      for(const candidate of universe){
        movers.push(await client.extendedHoursSnapshot(candidate.ticker,previousSessionDate,currentSessionDate));
      }

      const newsResponse=await client.news(undefined,10);
      if(newsResponse.ok)news=newsResponse.data;

      // EDGAR es una API distinta, con su propio límite: no compite por el de Massive.
      catalysts=await Promise.all(
        movers.slice(0,DAILY_REPORT_MAX_CATALYSTS).map(mover=>
          fetchSecCompanySnapshot(mover.ticker).catch(cause=>({ticker:mover.ticker,companyName:null,filings:[],latestRevenue:null,retrievedAt:null,error:cause instanceof Error?cause.message:String(cause)}))
        )
      );
    }
  }catch(cause){
    extendedHoursSource={connected:false,brokerName:null,error:cause instanceof Error?cause.message:String(cause)};
  }

  return{
    generatedAtIso:now.toISOString(),
    previousSessionDate,currentSessionDate,
    extendedHoursSource,indices,movers,news,catalysts,marketHolidays,marketStatus,
    vix:vixSummary,macro,
  };
}

// El PDF se renderiza con el Chromium que Electron ya trae incluido: una ventana
// oculta carga el HTML y `printToPDF` lo captura. No se añade ninguna dependencia
// nueva (nada de puppeteer) solo para generar un documento una vez al día.
async function renderReportPdf(html){
  const win=new BrowserWindow({show:false,webPreferences:{offscreen:true}});
  try{
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const buffer=await win.webContents.printToPDF({printBackground:true,pageSize:'Letter'});
    const target=path.join(app.getPath('temp'),`sentinel-informe-diario-${new Date().toISOString().replace(/[:.]/g,'-')}.pdf`);
    await fs.writeFile(target,buffer);
    return target;
  }finally{
    win.destroy();
  }
}

async function buildDailyReport(){
  const assets=await buildDailyReportAssets();
  // La vista previa de WhatsApp lista los movimientos más marcados del premercado.
  const candidates=assets.movers
    .filter(mover=>mover.premarket)
    .sort((a,b)=>Math.abs(b.premarket.changePercent??0)-Math.abs(a.premarket.changePercent??0))
    .map(mover=>({
      symbol:mover.ticker,market:'STOCK',
      direction:(mover.premarket.changePercent??0)>=0?'BUY':'SELL',
      score:Number((mover.premarket.changePercent??0).toFixed(2)),
      description:'premercado',
    }));
  const text=composeDailyReportText({generatedAtIso:assets.generatedAtIso,candidates,maxCandidates:DAILY_REPORT_MAX_PREVIEW});
  const html=buildDailyReportHtml(assets);
  const pdfPath=await renderReportPdf(html);
  return{text,pdfPath};
}

async function sendDailyReport(){
  const [notifier,report]=[await readSignalNotifier(),await readDailyReportConfig()];
  if(!report.enabled)return{status:'DISABLED'};
  if(!/^\+[1-9]\d{7,14}$/.test(notifier.target))throw new Error('No hay destino de WhatsApp configurado para el informe diario.');
  const{text,pdfPath}=await buildDailyReport();
  await sendOpenClawMessage(notifier,text,false,{mediaPath:pdfPath});
  await appendLedger('DAILY_REPORT_SENT',{charCount:text.length,target:notifier.target.replace(/\d(?=\d{4})/g,'*'),hasPdf:true});
  return{status:'SENT',charCount:text.length};
}

let dailyReportScheduler=null,dailyReportSchedulerState=null;
ipcMain.handle('daily-report:get',async()=>({ok:true,config:await readDailyReportConfig(),schedule:dailyReportSchedulerState}));
ipcMain.handle('daily-report:save',async(_event,value)=>({ok:true,config:await writeDailyReportConfig(value)}));
ipcMain.handle('daily-report:send-now',async()=>{
  const [notifier]=[await readSignalNotifier()];
  if(!/^\+[1-9]\d{7,14}$/.test(notifier.target))throw new Error('Destino WhatsApp inválido.');
  const{text,pdfPath}=await buildDailyReport();
  await sendOpenClawMessage(notifier,text,false,{mediaPath:pdfPath});
  await appendLedger('DAILY_REPORT_SENT',{charCount:text.length,target:notifier.target.replace(/\d(?=\d{4})/g,'*'),reason:'MANUAL',hasPdf:true});
  return{ok:true,charCount:text.length};
});

function decodeXml(value='') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function parseRss(xml, source, credibility) {
  return (xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]).slice(0,40).flatMap((item,index)=>{
    const pick=tag=>decodeXml((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'))||[])[1]||'');
    const title=pick('title'),url=pick('link'),publishedAt=pick('pubDate')||pick('dc:date');
    return title&&url?[{id:`${source}-${index}-${title}`,title,url,publishedAt:new Date(publishedAt||Date.now()).toISOString(),source,credibility,summary:pick('description')}]:[];
  });
}
async function loadNewsSnapshot() {
  const checkedAt=new Date().toISOString();
  const gdeltUrl='https://api.gdeltproject.org/api/v2/doc/doc?query=(markets%20OR%20economy%20OR%20bitcoin%20OR%20central%20bank)&mode=artlist&maxrecords=50&format=json&sort=datedesc';
  const results=await Promise.allSettled([
    fetchText('https://www.federalreserve.gov/feeds/press_monetary.xml'),
    fetchText('https://www.ecb.europa.eu/rss/press.html'),
    fetchJson(gdeltUrl)
  ]);
  let articles=[];const errors=[];
  if(results[0].status==='fulfilled')articles.push(...parseRss(results[0].value,'Federal Reserve',100));else errors.push(`Reserva Federal: ${results[0].reason?.message||'sin respuesta'}`);
  if(results[1].status==='fulfilled')articles.push(...parseRss(results[1].value,'Banco Central Europeo',100));else errors.push(`BCE: ${results[1].reason?.message||'sin respuesta'}`);
  if(results[2].status==='fulfilled')articles.push(...(results[2].value?.articles||[]).map((item,index)=>({id:`GDELT-${index}-${item.title}`,title:item.title,url:item.url,publishedAt:item.seendate?`${item.seendate.slice(0,4)}-${item.seendate.slice(4,6)}-${item.seendate.slice(6,8)}T${item.seendate.slice(9,11)}:${item.seendate.slice(11,13)}:${item.seendate.slice(13,15)}Z`:checkedAt,source:item.domain||'GDELT',credibility:65,summary:'',sourceCountry:item.sourcecountry||null})));else errors.push(`GDELT: ${results[2].reason?.message||'sin respuesta'}`);
  const seen=new Set();articles=articles.filter(item=>{const key=item.title.toLowerCase().replace(/[^a-z0-9]/g,'');if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,100);
  return {checkedAt,articles,errors,sources:[{name:'Federal Reserve',type:'oficial'},{name:'Banco Central Europeo',type:'oficial'},{name:'GDELT',type:'agregador'}]};
}
ipcMain.handle('news:snapshot', async()=>{const value=await loadNewsSnapshot();const evidence=await appendLedger('NEWS_SNAPSHOT',value);return{...value,evidenceHash:evidence.hash}});
ipcMain.handle('data:ledger-status', async()=>verifyLedger());
ipcMain.handle('data:ledger-repair', async()=>ledgerStore().repair());
async function loadVerifiedQuantDataset(datasetId){const store=quantResearchStore(),entry=await store.get('dataset',String(datasetId||''));if(!entry)throw new Error('Dataset no registrado.');const reference=String(entry.payload?.dataReference||''),root=path.resolve(store.root),resolved=path.resolve(root,reference),relative=path.relative(root,resolved);if(!reference||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Referencia de datos inválida.');const raw=JSON.parse(await fs.readFile(resolved,'utf8')),checksum=createHash('sha256').update(stableJson(raw)).digest('hex');if(checksum!==entry.payload.checksum)throw new Error('Checksum del dataset no coincide; investigación bloqueada.');return{store,entry,raw,checksum}}
ipcMain.handle('quant:datasets-list',async event=>{assertTrustedIpc(event);const entries=await quantResearchStore().list('dataset');return{ok:true,datasets:entries.map(entry=>entry.payload)}});
ipcMain.handle('quant:experiment-prepare',async(event,request)=>{assertTrustedIpc(event);if(request?.mode!=='ANALYSIS_ONLY'||request?.strategy!=='SMC')throw new Error('Solicitud Quant fuera del contrato seguro.');const datasetId=String(request?.datasetId||'').trim();if(!datasetId)throw new Error('Debe seleccionar un dataset registrado.');const dataset=await loadVerifiedQuantDataset(datasetId);if(dataset.entry.payload?.qualityStatus==='DATA_INVALID')throw new Error('Un dataset DATA_INVALID no puede utilizarse.');validateTrustedQuantPreparation({dataset:{provenance:dataset.entry.payload,raw:dataset.raw},config:request?.config});const experimentId=`Q-${randomUUID()}`,payload={...request,experimentId,datasetId,preparedAt:new Date().toISOString(),status:'PREPARED',executionAuthorized:false};const stored=await dataset.store.append('experiment',payload);await appendLedger('QUANT_EXPERIMENT_PREPARED',{experimentId,datasetId,datasetChecksum:dataset.checksum,mode:'ANALYSIS_ONLY'});return{ok:true,experiment:stored.entry.payload}});
ipcMain.handle('quant:dataset-load',async(event,datasetId)=>{assertTrustedIpc(event);const dataset=await loadVerifiedQuantDataset(datasetId);return{ok:true,provenance:dataset.entry.payload,raw:dataset.raw}});
async function executeTrustedQuantBacktest(payload){const experimentId=String(payload?.experimentId||''),datasetId=String(payload?.datasetId||''),store=quantResearchStore(),experiment=await store.get('experiment',experimentId);if(!experiment||experiment.payload?.datasetId!==datasetId)throw new Error('Experimento o dataset no coinciden.');const dataset=await loadVerifiedQuantDataset(datasetId),computedAt=String(experiment.payload?.preparedAt||''),envelope=await runTrustedQuantBacktest({experimentId,datasetId,dataset:{provenance:dataset.entry.payload,raw:dataset.raw},config:experiment.payload.config,now:computedAt}),output=envelope.output;if(envelope.authority!=='SENTINEL_BACKEND_V1'||!output||!Array.isArray(output.records)||output.records.some(record=>record.experimentId!==experimentId))throw new Error('El backend Quant no produjo evidencia confiable.');for(const record of output.records)await store.append('setup',record);const resultId=`BACKTEST:${experimentId}`,summary={resultId,experimentId,datasetId,status:'COMPLETED',completedAt:envelope.computedAt,result:output.result,statistics:output.statistics,execution:output.execution,versions:experiment.payload.versions,computationAuthority:'SENTINEL_BACKEND_V1',datasetChecksum:envelope.datasetChecksum};const stored=await store.append('result',summary);await appendLedger('QUANT_BACKTEST_COMPLETED',{resultId,experimentId,datasetId,datasetChecksum:envelope.datasetChecksum,authority:envelope.authority,trades:Number(output.statistics?.sampleSize)||0,netR:Number(output.result?.netR)||0});return{ok:true,result:stored.entry.payload,output,authority:envelope.authority}}
async function loadDurableQuantComputation(experimentId){
  const normalized=String(experimentId||'').trim(),store=quantResearchStore(),experiment=await store.get('experiment',normalized);
  if(!normalized||!experiment)throw new Error('Experimento Quant durable no registrado.');
  const datasetId=String(experiment.payload?.datasetId||''),dataset=await loadVerifiedQuantDataset(datasetId),base=await store.get('result',`BACKTEST:${normalized}`);
  if(!base)throw new Error('El backtest base no existe.');
  const computedAt=String(experiment.payload?.preparedAt||'');
  return{experimentId:normalized,datasetId,store,experiment,dataset,base,computedAt,input:{experimentId:normalized,datasetId,dataset:{provenance:dataset.entry.payload,raw:dataset.raw},config:experiment.payload.config,now:computedAt}};
}
function assertTrustedQuantEnvelope(envelope,context,stage){
  if(envelope?.authority!=='SENTINEL_BACKEND_V1'||envelope?.stage!==stage||envelope?.experimentId!==context.experimentId||envelope?.datasetId!==context.datasetId||envelope?.datasetChecksum!==context.dataset.checksum||!envelope?.output||envelope.executionAuthorized!==false)throw new Error('El backend Quant no produjo evidencia derivada confiable.');
}
function trustedStageStatus(output){return String(output?.status||'COMPLETED')}
async function persistTrustedQuantStage(context,stage,envelope,output=envelope.output){
  assertTrustedQuantEnvelope(envelope,context,stage);
  const resultId=`${stage}:${context.experimentId}`,summary={resultId,experimentId:context.experimentId,datasetId:context.datasetId,stage,status:trustedStageStatus(output),completedAt:envelope.computedAt,output,computationAuthority:'SENTINEL_BACKEND_V1',datasetChecksum:envelope.datasetChecksum};
  const stored=await context.store.append('result',summary);
  await appendLedger('QUANT_VALIDATION_COMPLETED',{resultId,experimentId:context.experimentId,stage,status:summary.status,authority:envelope.authority,datasetChecksum:envelope.datasetChecksum});
  return{ok:true,result:stored.entry.payload,output:envelope.output,authority:envelope.authority};
}
ipcMain.handle('quant:backtest-save',async(event,payload)=>{assertTrustedIpc(event);return executeTrustedQuantBacktest(payload)});
ipcMain.handle('quant:backtest-run',async(event,payload)=>{assertTrustedIpc(event);return executeTrustedQuantBacktest(payload)});
ipcMain.handle('quant:validation-save',async(event,payload)=>{
  assertTrustedIpc(event);
  const stage=String(payload?.stage||''),supported=['OUT_OF_SAMPLE','MONTE_CARLO','BENCHMARK','ROBUSTNESS','ABLATION_PLAN','ABLATION_VALIDATION','QUANT_GATE'];
  if(stage==='WALK_FORWARD')throw new Error('WALK_FORWARD_BLOCKED: el diagnóstico rolling actual no reentrena ni prueba el modelo causalmente; no se persistirá como validación.');
  if(!supported.includes(stage))throw new Error('Etapa de validación no soportada.');
  const context=await loadDurableQuantComputation(payload?.experimentId);
  if(stage!=='OUT_OF_SAMPLE'&&!await context.store.get('result',`OUT_OF_SAMPLE:${context.experimentId}`))throw new Error('OOS debe congelarse antes de esta validación.');
  if(stage==='ABLATION_VALIDATION'&&!await context.store.get('result',`ABLATION_RUN:${context.experimentId}`))throw new Error('Las variantes Challenger no han sido ejecutadas.');
  const operationalEvidence=stage==='QUANT_GATE'?{paperEvents:(await sentinelOperationalStore().list('paper')).map(entry=>entry.payload),shadowEvents:(await sentinelOperationalStore().list('shadow')).map(entry=>entry.payload)}:undefined;
  const datasetReuseCount=(await context.store.list('experiment')).filter(entry=>entry.payload?.datasetId===context.datasetId).length;
  const envelope=await runTrustedQuantStage({...context.input,stage,datasetReuseCount,operationalEvidence});
  const response=await persistTrustedQuantStage(context,stage,envelope);
  if(stage==='ABLATION_PLAN'){
    const models=envelope.output?.models;
    if(!Array.isArray(models)||models.some(model=>model?.status!=='CHALLENGER'||model?.promotionStatus!=='NOT_REQUESTED'||!Array.isArray(model?.experimentIds)||!model.experimentIds.includes(context.experimentId)))throw new Error('El backend produjo un registro Challenger inválido.');
    const entries=[];for(const model of models)entries.push((await context.store.append('model',model)).entry.payload);
    await appendLedger('QUANT_CHALLENGERS_REGISTERED',{experimentId:context.experimentId,models:entries.map(model=>model.modelId),authority:envelope.authority,datasetChecksum:envelope.datasetChecksum});
  }
  return response;
});
const AUTONOMOUS_RUNTIME_STATES=new Set(['READY','DEGRADED','BLOCKED','DISABLED','ERROR']);
function normalizeAutonomousRuntimeHeartbeat(input){
  if(!input||typeof input!=='object'||input.liveOrderSent!==false||input.executionAuthorized!==false)throw new Error('Heartbeat autónomo inseguro.');
  const state=String(input.state||''),checkedAt=String(input.checkedAt||''),timestamp=Date.parse(checkedAt);
  if(!AUTONOMOUS_RUNTIME_STATES.has(state)||!Number.isFinite(timestamp)||timestamp>Date.now()+2*60_000)throw new Error('Heartbeat autónomo inválido.');
  const nonNegative=field=>{const value=Number(input[field]);if(!Number.isSafeInteger(value)||value<0)throw new Error(`Heartbeat autÃ³nomo requiere ${field} entero no negativo.`);return value};
  return{schemaVersion:1,state,checkedAt:new Date(timestamp).toISOString(),nextIntervalMinutes:Math.max(1,Math.min(60,Number(input.nextIntervalMinutes)||2)),paperJournalEvents:nonNegative('paperJournalEvents'),shadowJournalEvents:nonNegative('shadowJournalEvents'),activePaper:nonNegative('activePaper'),activeShadow:nonNegative('activeShadow'),symbols:Array.isArray(input.symbols)?input.symbols.slice(0,100).map(item=>({symbol:String(item?.symbol||'').slice(0,80),instrumentId:String(item?.instrumentId||'').slice(0,120),state:String(item?.state||'').slice(0,40),anchorTime:item?.anchorTime==null?null:String(item.anchorTime).slice(0,64),error:item?.error==null?null:String(item.error).slice(0,300)})):[],reasonCodes:Array.isArray(input.reasonCodes)?input.reasonCodes.slice(0,100).map(value=>String(value).slice(0,120)):[],errors:Array.isArray(input.errors)?input.errors.slice(0,50).map(value=>String(value).slice(0,300)):[],liveOrderSent:false,executionAuthorized:false};
}
ipcMain.handle('autonomous:heartbeat-save',async(event,input)=>{assertTrustedIpc(event);const heartbeat=normalizeAutonomousRuntimeHeartbeat(input),stored=await sentinelOperationalStore().saveRuntimeHeartbeat(heartbeat);return{ok:true,heartbeat:stored}});
ipcMain.handle('autonomous:heartbeat-latest',async event=>{assertTrustedIpc(event);return{ok:true,heartbeat:await sentinelOperationalStore().readRuntimeHeartbeat()}});
ipcMain.handle('paper:events-list',async event=>{assertTrustedIpc(event);const entries=await sentinelOperationalStore().list('paper');return{ok:true,events:entries.map(entry=>entry.payload)}});
ipcMain.handle('paper:events-append',async(event,events)=>{assertTrustedIpc(event);if(!Array.isArray(events)||events.length===0)throw new Error('Paper requiere eventos para persistir.');if(events.some(item=>!item?.paperEventId||!item?.paperId||item?.paperId!==item?.observation?.paperId||item?.observation?.liveOrderSent!==false))throw new Error('Evento Paper inválido o inseguro.');const store=sentinelOperationalStore(),stored=[];for(const item of events)stored.push(await store.append('paper',item));const state=await store.readState(),latest=await store.list('paper'),active=[...new Map(latest.map(entry=>[entry.payload.paperId,entry.payload.observation])).values()].filter(item=>item.status==='PENDING_ENTRY'||item.status==='OPEN').map(item=>item.paperId);await store.saveState({...state,mode:state.mode==='SHADOW'?'SHADOW':'PAPER',checkpoints:{...state.checkpoints,paper:events.at(-1).paperEventId},activePaperIds:active});await appendLedger('PAPER_EVENTS_PERSISTED',{eventIds:events.map(item=>item.paperEventId),liveOrderSent:false});return{ok:true,created:stored.filter(item=>item.created).length,duplicates:stored.filter(item=>item.duplicate).length,activePaperIds:active}});
ipcMain.handle('shadow:events-list',async event=>{assertTrustedIpc(event);const entries=await sentinelOperationalStore().list('shadow');return{ok:true,events:entries.map(entry=>entry.payload)}});
ipcMain.handle('shadow:events-append',async(event,events)=>{assertTrustedIpc(event);if(!Array.isArray(events)||events.length===0)throw new Error('Shadow requiere eventos para persistir.');if(events.some(item=>!item?.shadowEventId||!item?.shadowId||item?.shadowId!==item?.observation?.shadowId||item?.observation?.liveOrderSent!==false))throw new Error('Evento Shadow inválido o inseguro.');const store=sentinelOperationalStore(),stored=[];for(const item of events)stored.push(await store.append('shadow',item));const state=await store.readState(),latest=await store.list('shadow'),active=[...new Map(latest.map(entry=>[entry.payload.shadowId,entry.payload.observation])).values()].filter(item=>item.status==='PENDING_ENTRY'||item.status==='OPEN').map(item=>item.shadowId);await store.saveState({...state,mode:'SHADOW',checkpoints:{...state.checkpoints,shadow:events.at(-1).shadowEventId},activeShadowIds:active});await appendLedger('SHADOW_EVENTS_PERSISTED',{eventIds:events.map(item=>item.shadowEventId),liveOrderSent:false});return{ok:true,created:stored.filter(item=>item.created).length,duplicates:stored.filter(item=>item.duplicate).length,activeShadowIds:active}});
ipcMain.handle('quant:readiness-save',async(event,payload)=>{assertTrustedIpc(event);const experimentId=String(payload?.experimentId||''),report=payload?.report,store=quantResearchStore();if(!experimentId||report?.experimentId!==experimentId)throw new Error('Live Readiness requiere un experimento consistente.');if(report?.liveEnabled!==false||report?.executionAuthorized!==false)throw new Error('Live Readiness no puede habilitar ejecución.');if(!await store.get('result',`BACKTEST:${experimentId}`)||!await store.get('result',`OUT_OF_SAMPLE:${experimentId}`))throw new Error('Backtest y OOS son obligatorios para registrar Live Readiness.');const resultId=`LIVE_READINESS:${experimentId}:${report.generatedAt}`,summary={resultId,experimentId,stage:'LIVE_READINESS',status:report.status,completedAt:new Date().toISOString(),output:report};const stored=await store.append('result',summary);await appendLedger('LIVE_READINESS_RECORDED',{resultId,experimentId,status:report.status,liveEnabled:false});return{ok:true,result:stored.entry.payload}});
ipcMain.handle('quant:challengers-register',async(event,payload)=>{assertTrustedIpc(event);const experimentId=String(payload?.experimentId||''),store=quantResearchStore(),plan=await store.get('result',`ABLATION_PLAN:${experimentId}`),models=plan?.payload?.output?.models;if(!plan||plan.payload?.computationAuthority!=='SENTINEL_BACKEND_V1'||!Array.isArray(models))throw new Error('Primero debe generarse un plan de ablación confiable.');if(models.some(model=>model?.status!=='CHALLENGER'||model?.promotionStatus!=='NOT_REQUESTED'||!Array.isArray(model?.experimentIds)||!model.experimentIds.includes(experimentId)))throw new Error('Registro Challenger durable inválido.');const entries=[];for(const model of models)entries.push((await store.append('model',model)).entry.payload);await appendLedger('QUANT_CHALLENGERS_REGISTERED',{experimentId,models:entries.map(model=>model.modelId),authority:'SENTINEL_BACKEND_V1',datasetChecksum:plan.payload.datasetChecksum});return{ok:true,models:entries,authority:'SENTINEL_BACKEND_V1'}});
ipcMain.handle('quant:ablation-save',async(event,payload)=>{
  assertTrustedIpc(event);
  const context=await loadDurableQuantComputation(payload?.experimentId);
  if(!await context.store.get('result',`ABLATION_PLAN:${context.experimentId}`))throw new Error('El plan de ablación no está registrado.');
  const envelope=await runTrustedQuantStage({...context.input,stage:'ABLATION_RUN'});assertTrustedQuantEnvelope(envelope,context,'ABLATION_RUN');
  const output=envelope.output,records=[...(output?.baseline?.records||[]),...(output?.runs||[]).flatMap(run=>run.records||[])];
  if(!Array.isArray(output?.runs)||records.some(record=>!String(record?.experimentId||'').startsWith(`${context.experimentId}:ABLATION:`)))throw new Error('El backend produjo una familia Challenger inválida.');
  for(const record of records)await context.store.append('setup',record);
  const compact={...output,baseline:{statistics:output.baseline.statistics,result:output.baseline.result},runs:output.runs.map(({records:discardedRecords,...run})=>run)};
  const response=await persistTrustedQuantStage(context,'ABLATION_RUN',envelope,compact);
  await appendLedger('QUANT_ABLATION_COMPLETED',{resultId:response.result.resultId,experimentId:context.experimentId,variants:output.runs.map(run=>run.variantId),blocked:output.blocked?.length||0,authority:envelope.authority});
  return response;
});
ipcMain.handle('quant:parameter-stability-save',async(event,payload)=>{
  assertTrustedIpc(event);
  const context=await loadDurableQuantComputation(payload?.experimentId);
  if(!await context.store.get('result',`OUT_OF_SAMPLE:${context.experimentId}`))throw new Error('OOS debe congelarse antes de estabilidad paramétrica.');
  const datasetReuseCount=(await context.store.list('experiment')).filter(entry=>entry.payload?.datasetId===context.datasetId).length;
  const envelope=await runTrustedParameterStability({...context.input,datasetReuseCount});assertTrustedQuantEnvelope(envelope,context,'PARAMETER_STABILITY');
  const output=envelope.output;
  if(output?.parentExperimentId!==context.experimentId||output?.oosAccessed!==false||!Array.isArray(output?.runs)||output.runs.length!==15)throw new Error('El backend produjo estabilidad paramétrica inválida.');
  for(const run of output.runs){
    if(!String(run?.experimentId||'').startsWith(`${context.experimentId}:PARAM:`)||!Array.isArray(run?.records)||run.records.some(record=>record.experimentId!==run.experimentId))throw new Error('Variante paramétrica fuera de la familia esperada.');
    await context.store.append('experiment',{...context.experiment.payload,experimentId:run.experimentId,parentExperimentId:context.experimentId,status:'COMPLETED',parameters:{...context.experiment.payload.parameters,stabilityParameter:run.parameter,stabilityValue:run.value},runTimestamp:envelope.computedAt});
    for(const record of run.records)await context.store.append('setup',record);
  }
  const compact={...output,runs:output.runs.map(({records:discardedRecords,...run})=>run)},response=await persistTrustedQuantStage(context,'PARAMETER_STABILITY',envelope,compact);
  await appendLedger('QUANT_PARAMETER_STABILITY_COMPLETED',{resultId:response.result.resultId,experimentId:context.experimentId,variantsTested:output.variantsTested,dataMiningRisk:output.dataMiningRisk,oosAccessed:false,authority:envelope.authority});
  return response;
});

function numberAt(parts,index){const value=Number(String(parts[index]??'').replace(/[^0-9.-]/g,''));return Number.isFinite(value)?value:null}
function parseCot(text,kind){return text.split(/\r?\n/).filter(Boolean).flatMap(line=>{const p=line.split(','),market=String(p[0]||'').replaceAll('"','').trim(),date=String(p[2]||'').trim();if(p.length<24||!market)return[];if(kind==='FINANCIAL')return[{market,date,openInterest:numberAt(p,7),assetManagerNet:(numberAt(p,11)??0)-(numberAt(p,12)??0),leveragedFundsNet:(numberAt(p,14)??0)-(numberAt(p,15)??0),source:'CFTC Traders in Financial Futures'}];return[{market,date,openInterest:numberAt(p,7),producerNet:(numberAt(p,8)??0)-(numberAt(p,9)??0),managedMoneyNet:(numberAt(p,13)??0)-(numberAt(p,14)??0),source:'CFTC Disaggregated COT'}]})}
async function loadInstitutionalFactors(){const year=new Date().getUTCFullYear(),results=await Promise.allSettled([
 fetchText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_real_yield_curve&field_tdr_date_value=${year}`),
 fetchText('https://www.cftc.gov/dea/newcot/FinFutWk.txt'),fetchText('https://www.cftc.gov/dea/newcot/f_disagg.txt'),
 fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),fetchJson('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
 fetchJson('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=24'),
 fetchJson('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=30'),
 fetchJson('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=30')]);const errors=[];let realYields=null,cot=[],cryptoDerivatives=null;
 if(results[0].status==='fulfilled'){const entries=results[0].value.match(/<entry>[\s\S]*?<\/entry>/g)||[],latest=entries.at(-1)||'',pick=k=>Number((latest.match(new RegExp(`<d:${k}[^>]*>([^<]+)<\\/d:${k}>`))||[])[1]),date=(latest.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/)||[])[1];if(date)realYields={date,y5:pick('TC_5YEAR'),y7:pick('TC_7YEAR'),y10:pick('TC_10YEAR'),y20:pick('TC_20YEAR'),y30:pick('TC_30YEAR'),source:'U.S. Department of the Treasury'};else errors.push('Tesoro real: respuesta no interpretable.')}else errors.push(`Tesoro real: ${results[0].reason?.message||'sin respuesta'}`);
 if(results[1].status==='fulfilled')cot.push(...parseCot(results[1].value,'FINANCIAL').filter(x=>/EURO FX|BRITISH POUND|JAPANESE YEN|BITCOIN|NASDAQ|S&P 500|U\.S\. DOLLAR INDEX/i.test(x.market)));else errors.push(`CFTC financiero: ${results[1].reason?.message||'sin respuesta'}`);
 if(results[2].status==='fulfilled')cot.push(...parseCot(results[2].value,'DISAGGREGATED').filter(x=>/GOLD|SILVER|CRUDE OIL|NATURAL GAS|COPPER/i.test(x.market)));else errors.push(`CFTC materias primas: ${results[2].reason?.message||'sin respuesta'}`);
 if(results[3].status==='fulfilled'&&results[4].status==='fulfilled'){const premium=results[3].value,open=results[4].value,hist=results[5].status==='fulfilled'?results[5].value:[],taker=results[6].status==='fulfilled'?results[6].value:[],accounts=results[7].status==='fulfilled'?results[7].value:[],first=hist[0],last=hist.at(-1),takerLast=taker.at(-1),accountLast=accounts.at(-1);cryptoDerivatives={symbol:'BTCUSDT',markPrice:Number(premium.markPrice),indexPrice:Number(premium.indexPrice),fundingRate:Number(premium.lastFundingRate),fundingAnnualizedPct:Number(premium.lastFundingRate)*3*365*100,nextFundingTime:new Date(Number(premium.nextFundingTime)).toISOString(),openInterest:Number(open.openInterest),openInterestValue:last?Number(last.sumOpenInterestValue):null,openInterest24hChangePct:first&&last?((Number(last.sumOpenInterest)-Number(first.sumOpenInterest))/Number(first.sumOpenInterest))*100:null,takerBuySellRatio:takerLast?Number(takerLast.buySellRatio):null,longShortAccountRatio:accountLast?Number(accountLast.longShortRatio):null,longAccountPct:accountLast?Number(accountLast.longAccount)*100:null,shortAccountPct:accountLast?Number(accountLast.shortAccount)*100:null,observedAt:new Date(Number(open.time)).toISOString(),source:'Binance USDⓈ-M Futures'};}else errors.push('Binance derivados: datos principales incompletos.');
 return{checkedAt:new Date().toISOString(),realYields,cot,cryptoDerivatives,errors,permissions:'public-read-only'} }
ipcMain.handle('institutional:factors',async()=>{const value=await loadInstitutionalFactors();const evidence=await appendLedger('INSTITUTIONAL_FACTORS',value);return{...value,evidenceHash:evidence.hash}});

function normalizeBinanceFuturesSymbol(value) {
  const compact=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (!/^[A-Z0-9]{2,16}$/.test(compact)) throw new Error('Símbolo cripto inválido.');
  return compact.endsWith('USDT') ? compact : `${compact.replace(/USD$/,'')}USDT`;
}
function emptyFlowSnapshot(symbol,status='CONNECTING') { return {ok:true,symbol,status,connected:false,startedAt:new Date().toISOString(),observedAt:null,lastTradeAt:null,lastLiquidationAt:null,lastBookAt:null,tradeCount:0,buyNotional:0,sellNotional:0,takerImbalance:0,liquidationCount:0,longLiquidationNotional:0,shortLiquidationNotional:0,liquidationImbalance:0,bid:null,ask:null,spreadBps:null,reconnects:0,source:'Binance USDⓈ-M Futures WebSocket',permissions:'public-read-only'}; }
function flowSnapshot(monitor) {
  return {...monitor.snapshot,...cryptoFlowWindowSnapshot(monitor.flowWindow,Date.now())};
}
function broadcastFlow(monitor) { const value=flowSnapshot(monitor); for(const win of BrowserWindow.getAllWindows()) win.webContents.send('crypto:flow-update',value); }
function scheduleFlowReconnect(monitor) {
  if(monitor.closed)return; monitor.snapshot.connected=false;monitor.snapshot.status='RECONNECTING';monitor.snapshot.reconnects+=1;broadcastFlow(monitor);
  clearTimeout(monitor.reconnectTimer);monitor.reconnectTimer=setTimeout(()=>connectCryptoFlow(monitor),Math.min(30000,1000*2**Math.min(monitor.snapshot.reconnects,5)));
}
function connectCryptoFlow(monitor) {
  const lower=monitor.symbol.toLowerCase(),url=`wss://fstream.binance.com/stream?streams=${lower}@aggTrade/${lower}@forceOrder/${lower}@bookTicker`;
  try {
    const socket=new WebSocket(url);monitor.socket=socket;
    socket.addEventListener('open',()=>{monitor.snapshot.connected=true;monitor.snapshot.status='LIVE';monitor.snapshot.reconnects=0;broadcastFlow(monitor)});
    socket.addEventListener('message',event=>{try{const envelope=JSON.parse(String(event.data)),stream=envelope.stream||'',data=envelope.data||{};
      const eventMs=Number(data.E)||Date.now(),eventAt=new Date(eventMs).toISOString();
      if(stream.endsWith('@aggTrade')){const notional=Number(data.p)*Number(data.q);monitor.snapshot.lastTradeAt=eventAt;if(Number.isFinite(notional))addTrade(monitor.flowWindow,{at:eventMs,side:data.m?'SELL':'BUY',notional})}
      else if(stream.endsWith('@forceOrder')){const order=data.o||{},notional=Number(order.ap||order.p)*Number(order.z||order.q);monitor.snapshot.lastLiquidationAt=eventAt;if(Number.isFinite(notional))addLiquidation(monitor.flowWindow,{at:eventMs,side:order.S==='SELL'?'LONG':'SHORT',notional})}
      else if(stream.endsWith('@bookTicker')){const bid=Number(data.b),ask=Number(data.a);monitor.snapshot.lastBookAt=eventAt;if(Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0){monitor.snapshot.bid=bid;monitor.snapshot.ask=ask;monitor.snapshot.spreadBps=((ask-bid)/((ask+bid)/2))*10000}}
      monitor.snapshot.observedAt=eventAt;const now=Date.now();if(now-monitor.lastBroadcast>=1000){monitor.lastBroadcast=now;broadcastFlow(monitor)}
    }catch{}});
    socket.addEventListener('close',()=>scheduleFlowReconnect(monitor));socket.addEventListener('error',()=>{try{socket.close()}catch{}});
  } catch { scheduleFlowReconnect(monitor); }
}
function stopCryptoFlow(symbol) { const monitor=cryptoFlowMonitors.get(symbol);if(!monitor)return;monitor.closed=true;clearTimeout(monitor.reconnectTimer);try{monitor.socket?.close()}catch{}cryptoFlowMonitors.delete(symbol); }
ipcMain.handle('crypto:flow-start',(_event,value)=>{const symbol=normalizeBinanceFuturesSymbol(value);let monitor=cryptoFlowMonitors.get(symbol);if(!monitor){monitor={symbol,snapshot:emptyFlowSnapshot(symbol),flowWindow:createCryptoFlowWindow(),socket:null,reconnectTimer:null,lastBroadcast:0,closed:false};cryptoFlowMonitors.set(symbol,monitor);connectCryptoFlow(monitor)}return flowSnapshot(monitor)});
ipcMain.handle('crypto:flow-stop',(_event,value)=>{const symbol=normalizeBinanceFuturesSymbol(value);stopCryptoFlow(symbol);return{ok:true,symbol}});
ipcMain.handle('crypto:flow-snapshot',(_event,value)=>{const symbol=normalizeBinanceFuturesSymbol(value),monitor=cryptoFlowMonitors.get(symbol);return monitor?flowSnapshot(monitor):{...emptyFlowSnapshot(symbol,'STOPPED'),ok:false}});

function historyPath() { return path.join(app.getPath('userData'), 'analysis-history.json'); }
function alertsPath() { return path.join(app.getPath('userData'), 'sentinel-alerts.json'); }
async function readAlerts(){try{const value=JSON.parse(await fs.readFile(alertsPath(),'utf8'));return Array.isArray(value)?value:[]}catch(error){if(error.code==='ENOENT')return[];throw error}}
// Dos escrituras concurrentes compartían un `.tmp` de nombre fijo: la primera lo
// renombraba y la segunda fallaba con ENOENT, perdiendo esa tanda de alertas. Se
// serializan las escrituras y cada una usa un temporal propio.
let alertsQueue=Promise.resolve();
async function writeAlerts(records){
  const task=alertsQueue.then(async()=>{
    const target=alertsPath(),temporary=`${target}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(temporary,JSON.stringify(records.slice(0,2000),null,2),'utf8');
    try{
      await fs.rename(temporary,target).catch(async error=>{
        // Windows puede negar el reemplazo directo si el destino está abierto.
        if(!['EEXIST','EPERM'].includes(error.code))throw error;
        await fs.unlink(target).catch(()=>{});
        await fs.rename(temporary,target);
      });
    }catch(error){
      await fs.unlink(temporary).catch(()=>{});
      throw error;
    }
  });
  alertsQueue=task.catch(()=>{});
  return task;
}
ipcMain.handle('alerts:list',async()=>({ok:true,records:await readAlerts()}));
ipcMain.handle('alerts:upsert',async(_event,incoming)=>{if(!Array.isArray(incoming))throw new Error('Alertas inválidas.');const records=upsertAlertCandidates(await readAlerts(),incoming,{now:new Date().toISOString(),createId:()=>randomUUID()});await writeAlerts(records);return{ok:true,records}});
ipcMain.handle('alerts:reconcile-operational',async(event,incoming)=>{assertTrustedIpc(event);if(!Array.isArray(incoming)||incoming.some(item=>!String(item?.fingerprint||'').startsWith('OPERATIONAL:')))throw new Error('Alertas operativas inválidas.');const records=await readAlerts(),now=new Date().toISOString(),activeFingerprints=new Set(incoming.map(item=>item.fingerprint));for(const record of records)if(String(record.fingerprint||'').startsWith('OPERATIONAL:')&&record.status==='ACTIVE'&&!activeFingerprints.has(record.fingerprint)){record.status='RESOLVED';record.resolvedAt=now}const merged=upsertAlertCandidates(records,incoming,{now,createId:()=>randomUUID()});await writeAlerts(merged);return{ok:true,records:merged}});
ipcMain.handle('alerts:acknowledge',async(_event,id)=>{const records=await readAlerts(),item=records.find(x=>x.id===id);if(item){item.status='ACKNOWLEDGED';item.acknowledgedAt=new Date().toISOString();await writeAlerts(records)}return{ok:Boolean(item),record:item||null}});
function watchlistsPath(){return path.join(app.getPath('userData'),'sentinel-watchlists.json')}
const defaultWatchlists={schemaVersion:1,activeListId:'global',intervalMinutes:2,lists:[{id:'global',name:'Mercados principales',symbols:['BTC/USD','EUR/USD','XAU/USD'],enabled:true}]};
async function readWatchlists(){try{const value=JSON.parse(await fs.readFile(watchlistsPath(),'utf8'));return value?.schemaVersion===1&&Array.isArray(value.lists)?value:defaultWatchlists}catch(error){if(error.code==='ENOENT')return defaultWatchlists;throw error}}
async function writeWatchlists(value){const normalized={schemaVersion:1,activeListId:String(value.activeListId||''),intervalMinutes:Math.max(1,Math.min(60,Number(value.intervalMinutes)||2)),lists:(value.lists||[]).slice(0,25).map(list=>({id:String(list.id),name:String(list.name||'Lista').slice(0,60),enabled:list.enabled!==false,symbols:[...new Set((list.symbols||[]).map(x=>String(x).trim().toUpperCase()).filter(Boolean))].slice(0,250)}))};if(!normalized.lists.some(x=>x.id===normalized.activeListId))normalized.activeListId=normalized.lists[0]?.id||'';const target=watchlistsPath(),temporary=`${target}.tmp`;await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(temporary,JSON.stringify(normalized,null,2),'utf8');await fs.rename(temporary,target);return normalized}
ipcMain.handle('watchlists:get',async()=>({ok:true,config:await readWatchlists()}));
ipcMain.handle('watchlists:save',async(_event,value)=>({ok:true,config:await writeWatchlists(value||defaultWatchlists)}));
function signalNotifierPath(){return path.join(app.getPath('userData'),'sentinel-signal-notifier.json')}
function signalDeliveryPath(){return path.join(app.getPath('userData'),'sentinel-signal-deliveries.json')}
function tradingViewConfigPath(){return path.join(app.getPath('userData'),'sentinel-tradingview-cloudflare.json')}
function tradingViewVixCachePath(){return path.join(app.getPath('userData'),'sentinel-tradingview-vix-context.json')}
const defaultTradingViewConfig={schemaVersion:1,enabled:false,endpoint:'',pollSeconds:10,maxAgeMinutes:30,consumerTokenEncrypted:''};
function applyLoginItemSetting(enabled){if(process.platform==='win32'&&app.isPackaged)app.setLoginItemSettings({openAtLogin:enabled===true,path:process.execPath,args:[]})}
async function persistSignalNotifier(normalized){const{target,...publicFields}=normalized,diskValue={...publicFields,targetEncrypted:target?encryptLocalSecret(target):''},targetPath=signalNotifierPath(),temporary=`${targetPath}.${randomUUID()}.tmp`;await fs.mkdir(path.dirname(targetPath),{recursive:true});await fs.writeFile(temporary,JSON.stringify(diskValue,null,2),'utf8');await fs.rename(temporary,targetPath).catch(async error=>{if(!['EEXIST','EPERM'].includes(error.code))throw error;await fs.unlink(targetPath).catch(()=>{});await fs.rename(temporary,targetPath)});return normalized}
async function readSignalNotifier(){if(signalNotifierCache)return signalNotifierCache;try{const diskValue=JSON.parse(await fs.readFile(signalNotifierPath(),'utf8')),target=diskValue.targetEncrypted?decryptLocalSecret(diskValue.targetEncrypted):String(diskValue.target||''),normalized=normalizeSignalNotifier({...diskValue,target}),requiresMigration=diskValue.schemaVersion!==3||typeof diskValue.startWithWindows!=='boolean'||Boolean(diskValue.target&&!diskValue.targetEncrypted);if(requiresMigration)await persistSignalNotifier(normalized);signalNotifierCache=normalized;applyLoginItemSetting(normalized.startWithWindows)}catch(error){if(error.code!=='ENOENT')throw error;signalNotifierCache={...defaultSignalNotifier};applyLoginItemSetting(signalNotifierCache.startWithWindows)}return signalNotifierCache}
async function writeSignalNotifier(value){const normalized=normalizeSignalNotifier(value);await persistSignalNotifier(normalized);applyLoginItemSetting(normalized.startWithWindows);signalNotifierCache=normalized;return normalized}
async function readSignalDeliveries(){try{const value=JSON.parse(await fs.readFile(signalDeliveryPath(),'utf8'));return Array.isArray(value)?value:[]}catch(error){if(error.code==='ENOENT')return[];throw error}}
async function writeSignalDeliveries(value){const pending=value.filter(record=>record?.deliveryStatus==='PENDING'),completed=value.filter(record=>record?.deliveryStatus!=='PENDING').slice(0,Math.max(0,500-pending.length)),retained=[...pending,...completed],target=signalDeliveryPath(),temporary=`${target}.tmp`;await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(temporary,JSON.stringify(retained,null,2),'utf8');await fs.rename(temporary,target)}
function serializeSignalDelivery(task){const result=signalDeliveryQueue.then(task);signalDeliveryQueue=result.catch(()=>{});return result}
function normalizeTradingViewEndpoint(value){const raw=String(value||'').trim().replace(/\/+$/,'');if(!raw)return'';let parsed;try{parsed=new URL(raw)}catch{throw new Error('La URL de Cloudflare no es valida.')}const local=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);if(parsed.protocol!=='https:'&&!(local&&parsed.protocol==='http:'))throw new Error('Cloudflare debe usar HTTPS. HTTP solo se admite en localhost.');if(parsed.username||parsed.password||parsed.search||parsed.hash||!['','/'].includes(parsed.pathname))throw new Error('Usa solo la URL base del Worker, sin rutas, credenciales, parametros ni fragmentos.');return parsed.toString().replace(/\/$/,'')}
function normalizeTradingViewConfig(value={},previous=defaultTradingViewConfig){return{schemaVersion:1,enabled:value.enabled===true,endpoint:normalizeTradingViewEndpoint(value.endpoint??previous.endpoint),pollSeconds:Math.max(5,Math.min(60,Number(value.pollSeconds)||10)),maxAgeMinutes:Math.max(5,Math.min(1440,Number(value.maxAgeMinutes)||30)),consumerTokenEncrypted:String(previous.consumerTokenEncrypted||'')}}
function publicTradingViewConfig(value){return{schemaVersion:1,enabled:value.enabled,endpoint:value.endpoint,pollSeconds:value.pollSeconds,maxAgeMinutes:value.maxAgeMinutes,hasToken:Boolean(value.consumerTokenEncrypted)}}
async function readTradingViewConfig(){if(tradingViewConfigCache)return tradingViewConfigCache;try{const value=JSON.parse(await fs.readFile(tradingViewConfigPath(),'utf8'));tradingViewConfigCache=normalizeTradingViewConfig(value,{...defaultTradingViewConfig,consumerTokenEncrypted:String(value.consumerTokenEncrypted||'')})}catch(error){if(error.code!=='ENOENT')throw error;tradingViewConfigCache={...defaultTradingViewConfig}}return tradingViewConfigCache}
function encryptLocalSecret(value){if(!safeStorage.isEncryptionAvailable())throw new Error('Windows no permitio cifrar el token local.');return safeStorage.encryptString(value).toString('base64')}
function decryptLocalSecret(value){if(!value)return'';try{return safeStorage.decryptString(Buffer.from(value,'base64'))}catch{return''}}
async function writeTradingViewConfig(value={}){
  const previous=await readTradingViewConfig(),normalized=normalizeTradingViewConfig(value,previous),token=String(value.consumerToken||'').trim();
  const endpointChanged=Boolean(previous.endpoint&&normalized.endpoint!==previous.endpoint);
  if(endpointChanged&&!token&&previous.consumerTokenEncrypted&&value.clearToken!==true)throw new Error('Al cambiar la URL de Cloudflare debes introducir nuevamente el token.');
  if(value.clearToken===true)normalized.consumerTokenEncrypted='';
  else if(token)normalized.consumerTokenEncrypted=encryptLocalSecret(token);
  const target=tradingViewConfigPath(),temporary=`${target}.tmp`;
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(temporary,JSON.stringify(normalized,null,2),'utf8');await fs.rename(temporary,target);
  tradingViewConfigCache=normalized;tradingViewVixCache=null;return publicTradingViewConfig(normalized);
}
async function tradingViewRequest(relative,options={}){const config=await readTradingViewConfig(),token=decryptLocalSecret(config.consumerTokenEncrypted);if(!config.endpoint)throw new Error('Falta la URL del Worker de Cloudflare.');if(!token)throw new Error('Falta el token de consulta de Sentinel.');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);try{const response=await fetch(`${config.endpoint}${relative}`,{...options,signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'User-Agent':sentinelUserAgent(),'Content-Type':'application/json',...(options.headers||{})}}),raw=await response.text();let body={};if(raw){try{body=JSON.parse(raw)}catch{body={detail:raw.slice(0,200)}}}if(!response.ok){const detail=typeof body?.error?.message==='string'?body.error.message:typeof body?.detail==='string'?body.detail:'';throw new Error(`Cloudflare respondio HTTP ${response.status}${detail?`: ${detail.slice(0,160)}`:''}`)}return body}finally{clearTimeout(timeout)}}
function emptyTradingViewVix(status='DISABLED',error=null){return{ok:false,status,contextType:'MARKET_CONTEXT',symbol:'VIX',operationalSignal:false,snapshot:null,history:[],checkedAt:new Date().toISOString(),fetchedAt:null,error}}
function normalizeVixNumber(value,field,required=false){if(value===null||value===undefined||value===''){if(required)throw new Error(`Cloudflare omitio ${field} del VIX.`);return null}const number=Number(value);if(!Number.isFinite(number)||number<=0||number>1000)throw new Error(`Cloudflare entrego ${field} invalido para VIX.`);return number}
function normalizeVixObservation(value){if(!value||value.source!=='TRADINGVIEW'||value.contextType!=='MARKET_CONTEXT'||value.symbol!=='VIX'||value.timeframe!=='D1')throw new Error('Cloudflare entrego un contrato VIX invalido.');const observationDate=String(value.observationDate||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(observationDate))throw new Error('Cloudflare entrego una fecha VIX invalida.');const observedAt=new Date(value.observedAt);if(!Number.isFinite(observedAt.getTime()))throw new Error('Cloudflare entrego una hora VIX invalida.');return{id:String(value.id||''),source:'TRADINGVIEW',contextType:'MARKET_CONTEXT',symbol:'VIX',rawSymbol:String(value.rawSymbol||'CBOE:VIX').slice(0,128),exchange:value.exchange==null?null:String(value.exchange).slice(0,64),timeframe:'D1',observationDate,value:normalizeVixNumber(value.value,'value',true),open:normalizeVixNumber(value.open,'open'),high:normalizeVixNumber(value.high,'high'),low:normalizeVixNumber(value.low,'low'),close:normalizeVixNumber(value.close,'close'),observedAt:observedAt.toISOString(),receivedAt:new Date(value.receivedAt).toISOString(),metadata:value.metadata&&typeof value.metadata==='object'&&!Array.isArray(value.metadata)?value.metadata:null,updatedAt:new Date(value.updatedAt||value.receivedAt).toISOString()}}
function normalizeTradingViewVixResponse(value,endpoint){if(!value||value.ok!==true||value.contextType!=='MARKET_CONTEXT'||value.symbol!=='VIX'||value.operationalSignal!==false||!Array.isArray(value.history))throw new Error('Cloudflare no devolvio el contexto diario VIX esperado.');const byDate=new Map();for(const row of value.history.slice(0,365)){const point=normalizeVixObservation(row);if(!byDate.has(point.observationDate))byDate.set(point.observationDate,point)}const history=[...byDate.values()].sort((a,b)=>b.observationDate.localeCompare(a.observationDate));return{ok:true,status:'READY',contextType:'MARKET_CONTEXT',symbol:'VIX',operationalSignal:false,snapshot:history[0]??null,history,checkedAt:new Date(value.checkedAt||Date.now()).toISOString(),fetchedAt:new Date().toISOString(),endpoint,error:null}}
async function writeTradingViewVixCache(value){const target=tradingViewVixCachePath(),temporary=`${target}.tmp`;await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(temporary,JSON.stringify(value,null,2),'utf8');await fs.rename(temporary,target)}
async function readTradingViewVixCache(endpoint){try{const value=JSON.parse(await fs.readFile(tradingViewVixCachePath(),'utf8'));if(value.endpoint!==endpoint)return null;return normalizeTradingViewVixResponse({...value,ok:true,contextType:'MARKET_CONTEXT',symbol:'VIX',operationalSignal:false},endpoint)}catch{return null}}
async function getTradingViewVixContext(force=false){const config=await readTradingViewConfig();if(!config.enabled)return emptyTradingViewVix();const now=Date.now();if(!force&&tradingViewVixCache?.endpoint===config.endpoint&&now-new Date(tradingViewVixCache.fetchedAt||0).getTime()<15*60_000)return tradingViewVixCache;try{const remote=normalizeTradingViewVixResponse(await tradingViewRequest('/api/v1/context/vix?limit=60'),config.endpoint);tradingViewVixCache=remote;await writeTradingViewVixCache(remote);return remote}catch(error){const cached=tradingViewVixCache?.endpoint===config.endpoint?tradingViewVixCache:await readTradingViewVixCache(config.endpoint);if(cached?.history?.length){tradingViewVixCache={...cached,status:'CACHED',error:error instanceof Error?error.message:'No se pudo actualizar VIX.'};return tradingViewVixCache}return emptyTradingViewVix('UNAVAILABLE',error instanceof Error?error.message:'No se pudo consultar VIX.')}}
async function getTradingViewMarketObservations(symbol,timeframe='',limit=20){const config=await readTradingViewConfig(),base={ok:false,status:config.enabled?'UNAVAILABLE':'DISABLED',contextType:'MARKET_OBSERVATION',operationalSignal:false,symbol:String(symbol||''),timeframe:timeframe||null,observations:[],checkedAt:new Date().toISOString(),error:null};if(!config.enabled)return base;try{const params=new URLSearchParams({symbol:String(symbol||''),limit:String(Math.max(1,Math.min(100,Number(limit)||20)))});if(timeframe)params.set('timeframe',String(timeframe));const remote=await tradingViewRequest(`/api/v1/market-observations?${params}`);if(remote?.ok!==true||remote.contextType!=='MARKET_OBSERVATION'||remote.operationalSignal!==false||!Array.isArray(remote.observations))throw new Error('Cloudflare no devolvio observaciones de mercado validas.');const observations=remote.observations.map(row=>{const observedAt=new Date(row.observedAt),receivedAt=new Date(row.receivedAt);if(row.source!=='TRADINGVIEW'||!Number.isFinite(observedAt.getTime())||!Number.isFinite(receivedAt.getTime()))throw new Error('Cloudflare entrego una observacion TradingView invalida.');for(const key of ['open','high','low','close'])if(!Number.isFinite(Number(row[key])))throw new Error(`Cloudflare entrego ${key} invalido.`);return{...row,open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:row.volume==null?null:Number(row.volume),observedAt:observedAt.toISOString(),receivedAt:receivedAt.toISOString()}});return{...base,ok:true,status:'READY',observations,checkedAt:new Date(remote.checkedAt||Date.now()).toISOString()}}catch(error){return{...base,error:error instanceof Error?error.message:'No se pudieron consultar observaciones TradingView.'}}}
async function testTradingViewConnection(){const remote=await tradingViewRequest('/api/v1/health');if(remote?.ok!==true||remote.service!=='sentinel-tradingview-bridge'||remote.contractVersion!==3||!Number.isFinite(Date.parse(remote.checkedAt)))throw new Error('La URL no devolvio el contrato de salud esperado de Sentinel.');return remote}
async function pullTradingViewSignals(limit=10){const config=await readTradingViewConfig();if(!config.enabled)return{ok:true,status:'DISABLED',signals:[],checkedAt:new Date().toISOString()};return tradingViewRequest('/api/v1/signals/claim',{method:'POST',body:JSON.stringify({limit:Math.max(1,Math.min(25,Number(limit)||10))})})}
async function acknowledgeTradingViewSignal(id,outcome={}){if(!id)throw new Error('Identificador TradingView invalido.');if(!['PROCESSED','EXPIRED','REJECTED','RETRY'].includes(outcome.status))throw new Error('Estado ACK TradingView invalido.');if(!/^[a-f0-9-]{36}$/i.test(String(outcome.leaseToken||'')))throw new Error('Reserva TradingView invalida.');return tradingViewRequest(`/api/v1/signals/${encodeURIComponent(String(id))}/ack`,{method:'POST',body:JSON.stringify({status:outcome.status,leaseToken:outcome.leaseToken,retryAfterSeconds:Math.max(10,Math.min(3600,Number(outcome.retryAfterSeconds)||60)),verdict:String(outcome.verdict||'').slice(0,60),detail:String(outcome.detail||'').slice(0,300)})})}
function openclawCli(){return{node:path.join(process.env.ProgramFiles||'C:\\Program Files','nodejs','node.exe'),entry:path.join(process.env.APPDATA||'','npm','node_modules','openclaw','openclaw.mjs')}}
function sendOpenClawMessage(config,message,dryRun=false,options={}){return new Promise((resolve,reject)=>{const cli=openclawCli(),args=[cli.entry,'message','send','--channel',config.channel,'--target',config.target,'--message',message,'--json'];if(options.mediaPath){args.push('--media',options.mediaPath);if(options.forceDocument!==false)args.push('--force-document')}if(dryRun)args.push('--dry-run');
  // El PDF de un informe diario tarda más que un aviso de texto en subirse; 30 s bastaba
  // para un mensaje corto pero mataba el envío de un adjunto antes de terminar.
  const timeoutMs=options.mediaPath?90000:30000;
  const child=spawn(cli.node,args,{windowsHide:true,timeout:timeoutMs,shell:false});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(stderr.trim()||`OpenClaw terminó con código ${code}`)))})}
ipcMain.handle('signal-notifier:get',async()=>({ok:true,config:await readSignalNotifier()}));
ipcMain.handle('signal-notifier:save',async(_event,value)=>({ok:true,config:await writeSignalNotifier(value)}));
ipcMain.handle('signal-notifier:test',async()=>{const config=await readSignalNotifier();if(!/^\+[1-9]\d{7,14}$/.test(config.target))throw new Error('Destino WhatsApp inválido.');await sendOpenClawMessage(config,'✅ Sentinel quedó conectado. Las señales válidas se enviarán por este canal sin usar IA ni consumir tokens.');return{ok:true}});
// Claude Opus 5 is restricted to Sentinel's explicit final signal review.
function consultOpenClaw(prompt){return new Promise((resolve,reject)=>{const cli=openclawCli(),args=[cli.entry,'agent','--agent','main','--session-id',crypto.randomUUID(),'--model',ANTHROPIC_REVIEW_MODEL,'--message',String(prompt).slice(0,7000),'--thinking','low','--timeout','90','--json'];const child=spawn(cli.node,args,{windowsHide:true,timeout:100000,shell:false});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error(stderr.trim()||`Consulta Claude Opus 5 terminó con código ${code}`));try{const value=JSON.parse(stdout),texts=[];const visit=x=>{if(typeof x==='string'){if(x.includes('APOYA_ENTRAR')||x.includes('NO_APOYA_ENTRAR'))texts.push(x)}else if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object')Object.values(x).forEach(visit)};visit(value);resolve(texts.at(-1)||stdout.trim())}catch{resolve(stdout.trim())}})})}

async function validateSentinelSignal(payload){
  return serializeSignalDelivery(async()=>{
    const config=await readSignalNotifier();
    if(!config.enabled)return{ok:false,status:'DISABLED'};
    if(
      !['ATOMIC','TRADINGVIEW'].includes(payload?.source)
      || typeof payload?.sourceSignalId!=='string'
      || !payload.sourceSignalId
      || payload.sourceSignalId.length>160
      || typeof payload?.analysisRecordId!=='string'
      || !payload.analysisRecordId
      || typeof payload?.prompt!=='string'
      || !payload.prompt
      || payload.prompt.length>7000
      || typeof payload?.messageTemplate!=='string'
      || !payload.messageTemplate.includes('{{VERDICT}}')
      || payload.messageTemplate.length>4000
    )return{ok:false,status:'INVALID'};
    payload={...payload,fingerprint:canonicalSignalFingerprint(payload)};
    const records=await readSignalDeliveries(),previous=records.find(x=>x.fingerprint===payload.fingerprint||sameSignalIdentity(x,payload));
    if(previous){
      if(!previous.deliveryStatus||previous.deliveryStatus==='SENT')return{ok:true,status:'DUPLICATE',verdict:previous.verdict,record:previous};
      if(classifySignalRetry(previous,Date.now()).status==='STALE'){await auditStaleSignalDelivery(records,previous,new Date().toISOString());return{ok:false,status:'ABANDONED',verdict:previous.verdict,record:previous}}
      try{await deliverPendingSignal(config,records,previous)}catch(error){return{ok:false,status:'PENDING',verdict:previous.verdict,consultation:previous.consultation,error:error instanceof Error?error.message:'error desconocido',record:previous}}
      return{ok:true,status:'SENT',verdict:previous.verdict,consultation:previous.consultation,record:previous};
    }
    const historyRecords=await readHistory();
    const trustedAnalysis=trustedReviewRecord(payload,historyRecords);
    const reviewEligible=Boolean(trustedAnalysis&&isExternalReviewEligible({
      ...payload,
      governanceCanVote:trustedAnalysis.governance.canVote,
      recommendationAuthorized:trustedAnalysis.record.recommendationAuthorized===true,
      executionAuthorized:false,
    }));
    let consultation='SIN_CONSULTA_IA - Sentinel no habilitó la revisión con Opus.',aiApproved=false;
    if(reviewEligible){
      try{
        consultation=String(await consultOpenClaw(payload.prompt)).replace(/\s+/g,' ').trim().slice(0,700);
        const responseToken=consultation.match(/^\s*(NO_APOYA_ENTRAR|APOYA_ENTRAR)\b/)?.[1];
        aiApproved=responseToken==='APOYA_ENTRAR';
      }catch(error){
        consultation=`NO_APOYA_ENTRAR - Consulta Julssbot no disponible: ${error instanceof Error?error.message:'error desconocido'}`;
      }
    }
    const verdict=externalReviewVerdict(reviewEligible,aiApproved);
    const message=String(payload.messageTemplate).replaceAll('{{VERDICT}}',verdict).replaceAll('{{AI}}',consultation);
    const record={...payload,message,consultation,verdict,algorithmApproved:reviewEligible,recommendationAuthorized:reviewEligible,executionStatus:'DISABLED',executionAuthorized:false,aiApproved,id:crypto.randomUUID(),validatedAt:new Date().toISOString(),deliveryStatus:'PENDING',deliveryAttempts:0,channel:config.channel,targetSuffix:config.target.slice(-4)};
    records.unshift(record);await writeSignalDeliveries(records);
    try{await appendLedger('SENTINEL_SIGNAL_VALIDATED',record)}catch(error){console.warn('No se pudo registrar la validación en el ledger:',error instanceof Error?error.message:'error desconocido')}
    try{await deliverPendingSignal(config,records,record)}catch(error){return{ok:false,status:'PENDING',verdict,consultation,error:error instanceof Error?error.message:'error desconocido',record}}
    return{ok:true,status:'SENT',verdict,consultation,record};
  });
}
async function deliverPendingSignal(config,records,record){
  record.deliveryAttempts=(Number(record.deliveryAttempts)||0)+1;
  record.lastDeliveryAttemptAt=new Date().toISOString();
  await writeSignalDeliveries(records);
  try{
    await sendOpenClawMessage(config,String(record.message).slice(0,3500));
  }catch(error){
    record.deliveryStatus='PENDING';
    await writeSignalDeliveries(records);
    throw error;
  }
  record.deliveryStatus='SENT';record.deliveredAt=new Date().toISOString();
  await writeSignalDeliveries(records);
  try{await appendLedger('SENTINEL_SIGNAL_DELIVERED',record)}catch(error){console.warn('No se pudo registrar la entrega en el ledger:',error instanceof Error?error.message:'error desconocido')}
}
function findSignalDelivery(records,identity){const raw=String(identity||'').trim(),legacy=parseLegacyRetryIdentity(raw);return records.find(record=>record.fingerprint===raw||(legacy&&sameSignalIdentity(record,legacy))||(!raw.includes('|')&&record.sourceSignalId===raw))||null}
async function auditStaleSignalDelivery(records,record,nowIso){abandonStaleSignal(record,nowIso);await writeSignalDeliveries(records);await appendLedger('SENTINEL_SIGNAL_ABANDONED',{fingerprint:record.fingerprint,source:record.source||null,sourceSignalId:record.sourceSignalId||record.atomicSignalId||null,validatedAt:record.validatedAt||null,abandonedAt:record.abandonedAt,abandonReason:'STALE_RETRY_EXPIRED',executionAuthorized:false});return record}
async function abandonExpiredSignalDeliveriesNow(){const records=await readSignalDeliveries(),now=Date.now(),nowIso=new Date(now).toISOString(),stale=records.filter(record=>classifySignalRetry(record,now).status==='STALE');for(const record of stale)await auditStaleSignalDelivery(records,record,nowIso);return{records,abandoned:stale.length}}
async function retryPendingSignalDeliveriesNow(limit=10){const{records,abandoned}=await abandonExpiredSignalDeliveriesNow(),now=Date.now(),config=await readSignalNotifier();if(!config.enabled)return{ok:false,status:'DISABLED',retried:0,sent:0,pending:records.filter(record=>record?.deliveryStatus==='PENDING').length,abandoned};const eligible=records.filter(record=>classifySignalRetry(record,now).status==='READY').slice(0,Math.max(1,Math.min(25,Number(limit)||10)));let sent=0,pending=0;for(const record of eligible){try{await deliverPendingSignal(config,records,record);sent++}catch{pending++}}return{ok:true,status:'COMPLETED',retried:eligible.length,sent,pending,abandoned,remaining:records.filter(record=>record?.deliveryStatus==='PENDING').length}}
function retryPendingSignalDeliveries(limit=10){return serializeSignalDelivery(()=>retryPendingSignalDeliveriesNow(limit))}
ipcMain.handle('signal-notifier:deliver',async(_event,payload)=>serializeSignalDelivery(async()=>{
  const config=await readSignalNotifier();if(!config.enabled)return{ok:false,status:'DISABLED'};
  if(!payload?.fingerprint||!payload?.message)return{ok:false,status:'INVALID'};
  const records=await readSignalDeliveries(),previous=records.find(x=>x.fingerprint===payload.fingerprint);
  if(previous){
    if(!previous.deliveryStatus||previous.deliveryStatus==='SENT')return{ok:true,status:'DUPLICATE',record:previous};
    if(classifySignalRetry(previous,Date.now()).status==='STALE'){await auditStaleSignalDelivery(records,previous,new Date().toISOString());return{ok:false,status:'ABANDONED',record:previous}}
    try{await deliverPendingSignal(config,records,previous)}catch(error){return{ok:false,status:'PENDING',error:error instanceof Error?error.message:'error desconocido',record:previous}}return{ok:true,status:'SENT',record:previous};
  }
  const record={...payload,id:crypto.randomUUID(),validatedAt:new Date().toISOString(),deliveryStatus:'PENDING',deliveryAttempts:0,channel:config.channel,targetSuffix:config.target.slice(-4)};
  records.unshift(record);await writeSignalDeliveries(records);
  try{await appendLedger('SIGNAL_NOTIFICATION_QUEUED',record)}catch(error){console.warn('No se pudo registrar la señal en el ledger:',error instanceof Error?error.message:'error desconocido')}
  try{await deliverPendingSignal(config,records,record)}catch(error){return{ok:false,status:'PENDING',error:error instanceof Error?error.message:'error desconocido',record}}return{ok:true,status:'SENT',record};
}));
ipcMain.handle('signal-notifier:retry-delivery',async(_event,fingerprint)=>serializeSignalDelivery(async()=>{
  const records=await readSignalDeliveries(),record=findSignalDelivery(records,fingerprint);
  if(!record)return{ok:false,status:'NOT_FOUND'};
  if(!record.deliveryStatus||record.deliveryStatus==='SENT')return{ok:true,status:'DUPLICATE',verdict:record.verdict,record};
  if(classifySignalRetry(record,Date.now()).status==='STALE'){await auditStaleSignalDelivery(records,record,new Date().toISOString());return{ok:false,status:'ABANDONED',verdict:record.verdict,record}}
  const config=await readSignalNotifier();if(!config.enabled)return{ok:false,status:'DISABLED'};
  try{await deliverPendingSignal(config,records,record)}catch(error){return{ok:false,status:'PENDING',verdict:record.verdict,error:error instanceof Error?error.message:'error desconocido',record}}return{ok:true,status:'SENT',verdict:record.verdict,record};
}));
ipcMain.handle('signal-notifier:retry-pending',async(_event,limit=10)=>retryPendingSignalDeliveries(limit));
ipcMain.handle('signal-notifier:abandon-delivery',async(_event,fingerprint,reason)=>serializeSignalDelivery(async()=>{
  const records=await readSignalDeliveries(),record=findSignalDelivery(records,fingerprint);
  if(!record)return{ok:true,status:'NOT_FOUND'};
  if(!record.deliveryStatus||record.deliveryStatus==='SENT')return{ok:true,status:'DUPLICATE',verdict:record.verdict,record};
  record.deliveryStatus='ABANDONED';record.abandonedAt=new Date().toISOString();record.abandonReason=String(reason||'EXPIRED').slice(0,120);
  await writeSignalDeliveries(records);
  try{await appendLedger('SENTINEL_SIGNAL_ABANDONED',record)}catch(error){console.warn('No se pudo registrar el abandono en el ledger:',error instanceof Error?error.message:'error desconocido')}
  return{ok:true,status:'ABANDONED',verdict:record.verdict,record};
}));
ipcMain.handle('signal-notifier:validate-atomic',async(event,payload)=>{assertTrustedIpc(event);return validateSentinelSignal({...payload,source:'ATOMIC',sourceSignalId:payload?.atomicSignalId})});
ipcMain.handle('signal-notifier:validate-external',async(event,payload)=>{assertTrustedIpc(event);return validateSentinelSignal(payload)});
ipcMain.handle('tradingview:get-config',async()=>({ok:true,config:publicTradingViewConfig(await readTradingViewConfig())}));
ipcMain.handle('tradingview:save-config',async(_event,value)=>({ok:true,config:await writeTradingViewConfig(value)}));
ipcMain.handle('tradingview:test',async()=>({ok:true,remote:await testTradingViewConnection()}));
ipcMain.handle('tradingview:vix-context',async(_event,force=false)=>getTradingViewVixContext(Boolean(force)));
ipcMain.handle('tradingview:market-observations',async(_event,symbol,timeframe,limit)=>getTradingViewMarketObservations(symbol,timeframe,limit));
ipcMain.handle('tradingview:pull',async(_event,limit)=>pullTradingViewSignals(limit));
ipcMain.handle('tradingview:ack',async(_event,id,outcome)=>acknowledgeTradingViewSignal(id,outcome));

const HISTORY_EVALUATION_BATCH_CAP=12;
const HISTORY_EVALUATION_PAGE_CAP=5000;
let historyQueue=Promise.resolve();
let historyEvaluationInFlight=null;
let historyEvaluationTimer=null;
let historyEvaluationStartupTimer=null;
function serializeHistory(task){const result=historyQueue.then(task);historyQueue=result.catch(()=>{});return result}
function normalizeHistoryRecord(record){
  const legacy=Number(record?.schemaVersion||1)<3;
  return{
    ...record,
    analyticalDecision:record?.analyticalDecision??record?.decision,
    analyticalConfidence:record?.analyticalConfidence??record?.confidence,
    legacySemantics:legacy||record?.legacySemantics===true,
    executionStatus:'DISABLED',
    executionAuthorized:false,
  };
}
function prepareHistoryRecord(record,records){return prepareHistoryDraft(record,records)}
async function readHistory() {
  try { const value = JSON.parse(await fs.readFile(historyPath(), 'utf8')); return Array.isArray(value) ? value.map(normalizeHistoryRecord) : []; }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function writeHistory(records) {
  const target = historyPath(), temporary = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive:true });
  await fs.writeFile(temporary, JSON.stringify(records.slice(0, 5000), null, 2), 'utf8');
  await fs.rename(temporary, target);
}
ipcMain.handle('history:list', async event => {assertTrustedIpc(event);return { ok:true, records:await readHistory() }});
ipcMain.handle('history:append', async (event, record) => {assertTrustedIpc(event);return serializeHistory(async()=>{
  if (!record || typeof record.symbol !== 'string' || typeof record.decision !== 'string') throw new Error('Registro de análisis inválido.');
  const records = await readHistory();
  const prepared=prepareHistoryRecord(record,records);
  const duplicate=prepared.analysisFingerprint
    ? records.find(item=>item.analysisFingerprint===prepared.analysisFingerprint&&item.modelFingerprint===prepared.modelFingerprint)
    : prepared.simulationFingerprint
      ? records.find(item=>item.simulationFingerprint===prepared.simulationFingerprint&&item.modelFingerprint===prepared.modelFingerprint)
      : null;
  if(duplicate)return{ok:true,duplicate:true,record:duplicate};
  const saved = normalizeHistoryRecord({ ...prepared, id:crypto.randomUUID(), createdAt:new Date().toISOString(), schemaVersion:3, legacySemantics:false, executionStatus:'DISABLED', executionAuthorized:false });
  const evidence=await appendLedger('ANALYSIS_RECOMMENDATION',saved);saved.evidenceHash=evidence.hash;
  records.unshift(saved); await writeHistory(records); return { ok:true, record:saved };
})});
async function evaluateHistoryBatchNow(){
  const attemptAt=new Date().toISOString();
  const selection=await serializeHistory(async()=>{
    const records=await readHistory();
    const {candidates,batch}=selectFairEvaluationBatch(records,HISTORY_EVALUATION_BATCH_CAP);
    const selectedIds=new Set(batch.map(record=>record.id));
    for(const record of records)if(selectedIds.has(record.id)){
      record.lastEvaluationAttemptAt=attemptAt;
      record.lastEvaluationError=null;
    }
    if(batch.length)await writeHistory(records);
    return{
      batch:batch.map(record=>structuredClone(record)),
      candidates:candidates.length,
      total:records.length,
    };
  });

  const updates=[];
  for(const record of selection.batch){
    try{
      const cursor=record.outcome?.lastEvaluatedAt||record.simulationAnchorTime;
      const response=await runMt5Bridge('rates_after',[
        '--symbol',String(record.brokerSymbol||record.symbol),
        '--timeframe',String(record.timeframe||'H1'),
        '--after',String(cursor),
        '--count',String(HISTORY_EVALUATION_PAGE_CAP),
      ]);
      if(!response.ok||!Array.isArray(response.candles))throw new Error(response.detail||response.error||'MT5 no devolvió barras válidas.');
      updates.push({
        id:record.id,
        simulationFingerprint:record.simulationFingerprint,
        previousStatus:record.outcome?.status??null,
        outcome:{
          ...evaluatePlan(record.plan,response.candles,record.simulationAnchorTime,record.outcome),
          dataHasMore:response.hasMore===true,
          queryUntil:response.queryUntil||attemptAt,
          source:'MetaTrader 5 local terminal',
        },
        error:null,
      });
    }catch(error){
      updates.push({
        id:record.id,
        simulationFingerprint:record.simulationFingerprint,
        previousStatus:record.outcome?.status??null,
        outcome:null,
        error:error instanceof Error?error.message.slice(0,300):'No se pudo evaluar la simulación.',
      });
    }
  }

  const records=await serializeHistory(async()=>{
    const latest=await readHistory();
    for(const update of updates){
      const record=latest.find(item=>item.id===update.id&&item.simulationFingerprint===update.simulationFingerprint);
      if(!record)continue;
      record.lastEvaluationAttemptAt=attemptAt;
      record.lastEvaluationError=update.error;
      if(update.outcome)record.outcome=update.outcome;
    }
    if(updates.length)await writeHistory(latest);
    return latest;
  });

  for(const update of updates.filter(item=>item.outcome)){
    try{
      await appendLedger('SIMULATION_OUTCOME_EVALUATED',{
        recordId:update.id,
        simulationFingerprint:update.simulationFingerprint,
        previousStatus:update.previousStatus,
        outcome:update.outcome,
        evaluatedAt:attemptAt,
      });
    }catch(error){
      console.warn('No se pudo registrar el resultado simulado en el ledger:',error instanceof Error?error.message:'error desconocido');
    }
  }

  const evaluated=updates.filter(item=>item.outcome).length;
  const failed=updates.length-evaluated;
  return{
    ok:true,
    evaluated,
    failed,
    attempted:selection.batch.length,
    skipped:Math.max(0,selection.total-selection.batch.length),
    pending:Math.max(0,selection.candidates-selection.batch.length),
    batchCap:HISTORY_EVALUATION_BATCH_CAP,
    records,
  };
}
function evaluateHistoryBatch(){
  if(historyEvaluationInFlight)return historyEvaluationInFlight;
  historyEvaluationInFlight=evaluateHistoryBatchNow().finally(()=>{historyEvaluationInFlight=null});
  return historyEvaluationInFlight;
}
ipcMain.handle('history:evaluate', async event=>{assertTrustedIpc(event);return evaluateHistoryBatch()});
ipcMain.handle('atomic:mt5', async () => {
  const common = path.join(process.env.APPDATA || '', 'MetaQuotes', 'Terminal', 'Common', 'Files', 'Sentinel');
  const statusPath = path.join(common, 'AtomicMT5_Status.txt'), signalsPath = path.join(common, 'AtomicMT5_Signals.txt');
  let status=null,signals=[],statusStat=null,signalStat=null;
  try { statusStat=await fs.stat(statusPath); status=atomicParser.parseStatus(await fs.readFile(statusPath,'utf8')); } catch {}
  try { signalStat=await fs.stat(signalsPath); signals=atomicParser.parseSignals(await fs.readFile(signalsPath,'utf8')); } catch {}
  const active=Boolean(statusStat&&Date.now()-statusStat.mtimeMs<15000);
  return {ok:Boolean(status||signals.length),active,statusFileModifiedAt:statusStat?.mtime.toISOString()||null,signalFileModifiedAt:signalStat?.mtime.toISOString()||null,status,signals:signals.slice(-500),latest:signals.at(-1)||null,permissions:'read-only'};
});

ipcMain.handle('atomic:test-reader', async () => {
  const common=path.join(process.env.APPDATA||'', 'MetaQuotes', 'Terminal', 'Common', 'Files', 'Sentinel');
  const requestPath=path.join(common,'AtomicMT5_TestRequest.txt'), signalsPath=path.join(common,'AtomicMT5_Signals.txt');
  const token=`TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.mkdir(common,{recursive:true});
  await fs.writeFile(requestPath,token,'utf8');
  for(let attempt=0;attempt<20;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,250));
    try {
      const signals=atomicParser.parseSignals(await fs.readFile(signalsPath,'utf8'));
      const ack=signals.find(item=>item.id===token&&item.type==='TEST_OK');
      if(ack) return {ok:true,sources:Number.isFinite(ack.value)?ack.value:0,ack};
    } catch {}
  }
  return {ok:false,sources:0,error:'El lector no respondió dentro de 5 segundos.'};
});

function atomicBridgeSourcePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'integrations', 'mt5', 'SentinelAtomicReader.ex5')
    : path.join(__dirname, '..', 'integrations', 'mt5', 'SentinelAtomicReader.ex5');
}

async function inspectAtomicTerminals() {
  const terminalRoot = path.join(process.env.APPDATA || '', 'MetaQuotes', 'Terminal');
  const terminals = [];
  let entries = [];
  try { entries = await fs.readdir(terminalRoot, { withFileTypes:true }); } catch { return terminals; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-F0-9]{20,}$/i.test(entry.name)) continue;
    const root = path.join(terminalRoot, entry.name);
    const atomicPath = path.join(root, 'MQL5', 'Indicators', 'Market', 'Atomic Analyst MT5.ex5');
    const bridgePath = path.join(root, 'MQL5', 'Experts', 'Sentinel', 'SentinelAtomicReader.ex5');
    const [atomicInstalled, bridgeInstalled] = await Promise.all([
      fs.access(atomicPath).then(()=>true).catch(()=>false),
      fs.access(bridgePath).then(()=>true).catch(()=>false)
    ]);
    if (atomicInstalled || bridgeInstalled) terminals.push({ id:entry.name, root, atomicInstalled, bridgeInstalled, bridgePath });
  }
  return terminals;
}

ipcMain.handle('atomic:terminals', async () => ({ ok:true, terminals:await inspectAtomicTerminals() }));
ipcMain.handle('atomic:install-reader', async (_event, terminalId) => {
  if (!/^[A-F0-9]{20,}$/i.test(String(terminalId || ''))) throw new Error('Terminal MT5 inválido.');
  const terminals = await inspectAtomicTerminals();
  const terminal = terminals.find(item => item.id === terminalId && item.atomicInstalled);
  if (!terminal) throw new Error('Atomic Analyst MT5 no fue encontrado en ese terminal.');
  await fs.mkdir(path.dirname(terminal.bridgePath), { recursive:true });
  await fs.copyFile(atomicBridgeSourcePath(), terminal.bridgePath);
  return { ok:true, terminal:{ ...terminal, bridgeInstalled:true }, restartRequired:true, permissions:'read-only' };
});

function mt5BridgeInvocation(command,args) {
  const executable=app.isPackaged?path.join(process.resourcesPath,'services','mt5_bridge.exe'):path.join(__dirname,'..','services','dist','mt5_bridge.exe');
  if(existsSync(executable))return{program:executable,args:[command,...args],mode:'STANDALONE_EXE'};
  const script=app.isPackaged?path.join(process.resourcesPath,'services','mt5_bridge.py'):path.join(__dirname,'..','services','mt5_bridge.py');
  return{program:'python',args:[script,command,...args],mode:'PYTHON_FALLBACK'};
}

function runMt5Bridge(command, args = []) {
  return new Promise((resolve, reject) => {
    const invocation=mt5BridgeInvocation(command,args),child = spawn(invocation.program, invocation.args, {
      windowsHide: true,
      timeout: 20000,
      shell:false
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      try {
        const payload = JSON.parse(stdout.trim());
        resolve({ ...payload, bridgeExitCode: code, bridgeMode:invocation.mode });
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || `MT5 bridge exited with ${code}`));
      }
    });
  });
}

ipcMain.handle('mt5:status', () => runMt5Bridge('status'));
async function performOperationalHealthRefresh(){
  const checkedAt=new Date().toISOString(),tvConfig=await readTradingViewConfig();
  const timedProbe=async task=>{const started=Date.now();try{return{status:'fulfilled',value:await task(),latencyMs:Date.now()-started}}catch(reason){return{status:'rejected',reason,latencyMs:Date.now()-started}}};
  const probes=await Promise.all([
    timedProbe(()=>runMt5Bridge('status')),
    timedProbe(()=>tvConfig.enabled?testTradingViewConnection():Promise.resolve(null)),
    timedProbe(()=>loadNewsSnapshot()),
    timedProbe(()=>quantResearchStore().list('dataset')),
    timedProbe(()=>verifyLedger({deep:true})),
    timedProbe(async()=>{const store=sentinelOperationalStore(),[heartbeat,paper,shadow]=await Promise.all([store.readRuntimeHeartbeat(),store.list('paper'),store.list('shadow')]),latest=entries=>[...new Map(entries.map(entry=>[entry?.payload?.observation?.paperId||entry?.payload?.observation?.shadowId,entry?.payload?.observation])).values()],paperLatest=latest(paper),shadowLatest=latest(shadow);return{heartbeat,paperCount:paper.length,shadowCount:shadow.length,paperSafe:paper.every(entry=>entry?.payload?.observation?.liveOrderSent===false),shadowSafe:shadow.every(entry=>entry?.payload?.observation?.liveOrderSent===false),paperRecoveryGap:paperLatest.some(item=>item?.status==='BLOCKED'&&item?.reasonCodes?.includes('RECOVERY_GAP')),shadowRecoveryGap:shadowLatest.some(item=>item?.status==='BLOCKED'&&item?.reasonCodes?.includes('RECOVERY_GAP'))}}),
  ]);
  const component=(id,critical,configured,result,evaluate,source='LIVE_PROBE')=>{if(!configured)return{id,status:'NOT_CONFIGURED',lastMessage:null,lastHeartbeat:null,latencyMs:null,critical,reasonCodes:['PROVIDER_NOT_CONFIGURED'],configured:false,checkedAt,source};if(result.status==='rejected')return{id,status:'ERROR',lastMessage:null,lastHeartbeat:null,latencyMs:result.latencyMs,critical,reasonCodes:[`${id}_ERROR`],configured:true,checkedAt,source};const verdict=evaluate(result.value),status=verdict.status||(verdict.ok?'HEALTHY':critical?'ERROR':'DEGRADED');return{id,status,lastMessage:verdict.ok?checkedAt:null,lastHeartbeat:verdict.lastHeartbeat??checkedAt,latencyMs:result.latencyMs,critical,reasonCodes:verdict.reasonCodes||[],configured:true,checkedAt,source}};
  const runtimeVerdict=value=>evaluateAutonomousRuntimeHeartbeat(value,Date.now(),{applicationStartedAt});
  const runtime=probes[5].status==='fulfilled'?runtimeVerdict(probes[5].value):null;
  const journalVerdict=(value,kind)=>evaluateRuntimeJournal(value,kind,runtime);
  const components=[
    component('MT5',true,true,probes[0],value=>{const connected=value?.ok===true&&value?.connected===true,clock=value?.clock,clockVerified=clock?.status==='UTC_CONFIRMED'||clock?.status==='BROKER_CLOCK_CORRECTED';return{ok:connected&&clockVerified,reasonCodes:!connected?['MT5_DISCONNECTED']:!clockVerified?['MT5_CLOCK_UNVERIFIED']:[]}}),
    component('TRADINGVIEW_CLOUDFLARE',Boolean(tvConfig.enabled),Boolean(tvConfig.enabled),probes[1],value=>({ok:value?.ok===true,reasonCodes:value?.ok===true?[]:['TRADINGVIEW_CLOUDFLARE_DEGRADED']})),
    component('NEWS',false,true,probes[2],value=>({ok:Array.isArray(value?.errors)&&value.errors.length===0,reasonCodes:Array.isArray(value?.errors)&&value.errors.length===0?[]:['NEWS_DEGRADED']})),
    component('QUANT_STORE',true,true,probes[3],value=>({ok:Array.isArray(value),reasonCodes:Array.isArray(value)?[]:['QUANT_STORE_ERROR']}),'LOCAL_STORE'),
    component('EVIDENCE_LEDGER',true,true,probes[4],value=>{const recovered=value?.recovered||Number(value?.historicalRecoveries)>0;return{ok:value?.ok===true,status:value?.ok!==true?'ERROR':recovered?'DEGRADED':'HEALTHY',reasonCodes:value?.ok!==true?['EVIDENCE_LEDGER_INVALID']:recovered?['EVIDENCE_LEDGER_RECOVERED']:[]}},'LOCAL_STORE'),
    component('AUTONOMOUS_RUNTIME',true,true,probes[5],runtimeVerdict,'DURABLE_HEARTBEAT'),
    component('PAPER_RUNTIME',true,true,probes[5],value=>journalVerdict(value,'PAPER'),'LOCAL_STORE'),
    component('SHADOW_RUNTIME',true,true,probes[5],value=>journalVerdict(value,'SHADOW'),'LOCAL_STORE'),
  ];
  const criticalFailure=components.some(item=>item.critical&&(item.status==='ERROR'||item.status==='OFFLINE')),degraded=components.some(item=>item.status==='DEGRADED'),overall=criticalFailure?'ERROR':degraded?'DEGRADED':'HEALTHY',reasonCodes=[...new Set(components.flatMap(item=>item.reasonCodes))],snapshot={schemaVersion:1,operationalEventId:`HEALTH:${checkedAt}`,timestamp:checkedAt,components,overall,blockNewOpportunities:criticalFailure,reasonCodes,liveEnabled:false,liveOrderSent:false,executionAuthorized:false};
  await sentinelOperationalStore().append('health',snapshot);await appendLedger('OPERATIONAL_HEALTH_SNAPSHOT',{operationalEventId:snapshot.operationalEventId,overall,reasonCodes,liveEnabled:false});await persistentLogger?.write(overall==='ERROR'?'ERROR':overall==='DEGRADED'?'WARN':'INFO','OPERATIONAL_HEALTH_REFRESH',{overall,reasonCodes,components:components.map(item=>({id:item.id,status:item.status,latencyMs:item.latencyMs}))});return snapshot;
}
function refreshOperationalHealth(){if(operationalHealthRefreshPromise)return operationalHealthRefreshPromise;operationalHealthRefreshPromise=performOperationalHealthRefresh().finally(()=>{operationalHealthRefreshPromise=null});return operationalHealthRefreshPromise}
ipcMain.handle('operational:health-refresh',async event=>{assertTrustedIpc(event);return{ok:true,snapshot:await refreshOperationalHealth()}});
ipcMain.handle('operational:health-latest',async event=>{assertTrustedIpc(event);const entries=await sentinelOperationalStore().list('health');return{ok:true,snapshot:entries.at(-1)?.payload??null}});
ipcMain.handle('operational:health-history',async(event,limit=500)=>{assertTrustedIpc(event);const bounded=Math.max(1,Math.min(5000,Number(limit)||500)),entries=await sentinelOperationalStore().list('health');return{ok:true,snapshots:entries.slice(-bounded).map(entry=>entry.payload),total:entries.length,retentionPolicy:{retentionDays:90,automaticDeletion:false}}});
ipcMain.handle('operational:collector-status',event=>{assertTrustedIpc(event);return{ok:true,state:operationalHealthScheduler?.state()??null,liveEnabled:false,executionAuthorized:false}});
ipcMain.handle('mt5:portfolio', () => runMt5Bridge('portfolio'));
ipcMain.handle('mt5:factors', () => runMt5Bridge('factors'));
ipcMain.handle('mt5:microstructure', (_event, symbol) => runMt5Bridge('microstructure', ['--symbol', String(symbol)]));
ipcMain.handle('mt5:catalog', (_event, search = '', limit = 100) =>
  runMt5Bridge('catalog', ['--search', String(search), '--limit', String(limit)]));
ipcMain.handle('mt5:rates', (_event, symbol, timeframe = 'H1', count = 300) =>
  runMt5Bridge('rates', ['--symbol', String(symbol), '--timeframe', String(timeframe), '--count', String(count)]));
ipcMain.handle('mt5:rates-after',(_event,symbol,timeframe='M5',after,count=5000,until=new Date().toISOString())=>{
  const normalizedFrame=String(timeframe).toUpperCase(),normalizedAfter=String(after||''),parsed=Date.parse(normalizedAfter),parsedUntil=Date.parse(String(until||'')),bounded=Math.max(1,Math.min(5000,Math.trunc(Number(count)||5000)));
  if(!/^(M1|M2|M3|M4|M5|M6|M10|M12|M15|M20|M30|H1|H2|H3|H4|H6|H8|H12|D1|W1|MN1)$/.test(normalizedFrame)||!Number.isFinite(parsed)||!Number.isFinite(parsedUntil)||parsedUntil<=parsed||parsedUntil>Date.now()+2*60_000)throw new Error('Cursor MT5 rates-after inválido.');
  return runMt5Bridge('rates_after',['--symbol',String(symbol),'--timeframe',normalizedFrame,'--after',new Date(parsed).toISOString(),'--until',new Date(parsedUntil).toISOString(),'--count',String(bounded)]);
});
ipcMain.handle('mt5:multi-rates', (_event, symbol, timeframes, count = 300) =>
  runMt5Bridge('multi_rates', ['--symbol', String(symbol), '--timeframes', timeframes.join(','), '--count', String(count)]));
ipcMain.handle('quant:mt5-dataset-import',async(event,input)=>{assertTrustedIpc(event);const symbol=String(input?.symbol||'').trim().toUpperCase(),assetClass=String(input?.assetClass||'').trim().toUpperCase(),timeframes=Array.isArray(input?.timeframes)?[...new Set(input.timeframes.map(value=>String(value).toUpperCase()))]:[],count=Math.max(100,Math.min(1000,Number(input?.count)||1000));if(!symbol||!timeframes.length)throw new Error('Símbolo y temporalidades son obligatorios.');const response=await runMt5Bridge('multi_rates',['--symbol',symbol,'--timeframes',timeframes.join(','),'--count',String(count)]);if(!response?.ok)throw new Error(response?.detail||response?.error||'MT5 no devolvió históricos.');const processingTimestamp=new Date().toISOString(),instrumentId=`${assetClass}_${symbol.replace(/[^A-Z0-9]/g,'_')}`;const bundle=buildMt5DatasetBundle({symbol,instrumentId,assetClass,timeframes,processingTimestamp,normalizationVersion:'1.0.0',response,exchange:response.results?.[timeframes[0]]?.instrument?.exchange||null});const root=quantResearchStore().root,dataPath=path.join(root,bundle.provenance.dataReference),temporaryPath=`${dataPath}.${randomUUID()}.tmp`;await fs.mkdir(path.dirname(dataPath),{recursive:true});await fs.writeFile(temporaryPath,JSON.stringify(bundle.raw),'utf8');try{await fs.rename(temporaryPath,dataPath)}catch(error){if(error.code==='EEXIST'||error.code==='EPERM'){await fs.unlink(temporaryPath).catch(()=>{})}else throw error}const stored=await quantResearchStore().append('dataset',bundle.provenance);await appendLedger('QUANT_DATASET_IMPORTED',{datasetId:bundle.provenance.datasetId,qualityStatus:bundle.provenance.qualityStatus,checksum:bundle.provenance.checksum});return{ok:true,created:stored.created,dataset:stored.entry.payload}});
async function importMt5CsvDatasets(){
  const csvRoot=path.resolve(app.getPath('desktop'),'sentinel market ai','historicos mt5'),sources=await discoverMt5CsvBundles(csvRoot),required=['D1','H4','H1','M15','M5'];
  if(!sources.length)throw new Error('No se encontraron históricos MT5 exportados.');
  const mt5Status=await runMt5Bridge('status'),brokerServer=String(mt5Status?.account?.server||''),brokerCompany=String(mt5Status?.account?.company||''),justMarkets=/^JustMarkets-/i.test(brokerServer)||/Just Global Markets/i.test(brokerCompany),timeOptions=justMarkets?{timeZone:'Etc/GMT-3',brokerServer}:{brokerServer};
  const imported=[];
  for(const source of sources){
    if(source.missing.length)throw new Error(`${source.brokerSymbol} no contiene: ${source.missing.join(', ')}.`);
    const fileStats=await Promise.all(source.files.map(file=>fs.stat(file))),processingTimestamp=new Date(Math.max(...fileStats.map(item=>item.mtimeMs))).toISOString(),loaded=await loadMt5CsvBundle(source,timeOptions),symbol=loaded.brokerSymbol,assetClass=/^(BTC|ETH|SOL|XRP)/i.test(symbol)?'CRYPTO':'FOREX',instrumentId=`${assetClass}_${symbol.toUpperCase().replace(/[^A-Z0-9]/g,'_')}`,bundle=buildMt5DatasetBundle({symbol,instrumentId,assetClass,timeframes:required,processingTimestamp,normalizationVersion:'1.1.0-csv',response:loaded.response,broker:'MT5 CSV export'});
    bundle.provenance.timezone=loaded.timezone;bundle.provenance.reasonCodes=loaded.reasonCodes;
    const store=quantResearchStore(),dataPath=path.join(store.root,bundle.provenance.dataReference),temporaryPath=`${dataPath}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(dataPath),{recursive:true});await fs.writeFile(temporaryPath,JSON.stringify(bundle.raw),'utf8');
    try{await fs.rename(temporaryPath,dataPath)}catch(error){if(error.code==='EEXIST'||error.code==='EPERM'){await fs.unlink(temporaryPath).catch(()=>{})}else throw error}
    const stored=await store.append('dataset',bundle.provenance);if(stored.created)await appendLedger('QUANT_CSV_DATASET_IMPORTED',{datasetId:bundle.provenance.datasetId,symbol,rows:bundle.provenance.rows,qualityStatus:bundle.provenance.qualityStatus,checksum:bundle.provenance.checksum,timezone:loaded.timezone});imported.push({created:stored.created,dataset:stored.entry.payload});
  }
  return{ok:true,imported};
}
ipcMain.handle('quant:mt5-csv-import',async event=>{assertTrustedIpc(event);return importMt5CsvDatasets()});
const MT5_SCAN_CACHE_MS=5*60_000;
let mt5ScanCache=null,mt5ScanPromise=null;
async function scanMt5Market(limit=300,force=false){
  const safeLimit=Math.max(25,Math.min(1000,Number(limit)||300));
  const now=Date.now();
  if(!force&&mt5ScanCache?.limit===safeLimit&&now-mt5ScanCache.checkedAt<MT5_SCAN_CACHE_MS){
    return{...mt5ScanCache.result,cacheStatus:'CACHED'};
  }
  if(mt5ScanPromise)return mt5ScanPromise;
  mt5ScanPromise=runMt5Bridge('scan',['--limit',String(safeLimit)])
    .then(result=>{
      if(result?.ok)mt5ScanCache={limit:safeLimit,checkedAt:Date.now(),result};
      return{...result,cacheStatus:'FRESH'};
    })
    .finally(()=>{mt5ScanPromise=null});
  return mt5ScanPromise;
}
ipcMain.handle('mt5:scan', (_event, limit = 300, force = false) =>
  scanMt5Market(limit,Boolean(force)));

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07101d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [`--sentinel-version=${app.getVersion()}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate',(event,url)=>{
    event.preventDefault();
    if(/^https?:/.test(url))void shell.openExternal(url);
  });

  const useLocalBuild = process.env.SENTINEL_LOCAL_BUILD === '1';
  if (!app.isPackaged && !useLocalBuild) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.on('close',event=>{if(!quitting&&signalNotifierCache?.enabled&&signalNotifierCache?.keepInTray){event.preventDefault();win.hide()}});
}

app.whenReady().then(async() => {
  if(!hasSingleInstanceLock)return;
  app.setAppUserModelId('com.julssbot.sentinelquants');
  // Capa adicional sobre sandbox y contextIsolation: el renderer no carga scripts ni
  // marcos externos, así que puede declararse una política estricta. Solo se aplica
  // empaquetado, porque el HMR de Vite necesita websockets y scripts en línea.
  if(app.isPackaged){
    const policy=[
      "default-src 'self'","script-src 'self'","style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:","font-src 'self' data:","connect-src 'self'",
      "object-src 'none'","frame-src 'none'","base-uri 'none'","form-action 'none'",
    ].join('; ');
    session.defaultSession.webRequest.onHeadersReceived((details,callback)=>{
      callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[policy]}});
    });
  }
  persistentLogger=createPersistentLogger(path.join(app.getPath('userData'),'logs'),{maxBytes:5*1024*1024,maxArchives:10});
  persistentLogger.captureConsole();
  process.on('uncaughtExceptionMonitor',error=>{void persistentLogger?.write('ERROR','UNCAUGHT_EXCEPTION',{error}).catch(()=>{})});
  process.on('unhandledRejection',reason=>{void persistentLogger?.write('ERROR','UNHANDLED_REJECTION',{reason}).catch(()=>{})});
  await persistentLogger.write('INFO','APPLICATION_START',{version:app.getVersion(),packaged:app.isPackaged,platform:process.platform});
  void ledgerStore().initialize().catch(error=>console.error('No se pudo inicializar el ledger de evidencia:',error));
  void readSignalNotifier().catch(error=>console.error('No se pudo cargar la configuración de avisos:',error));
  void serializeSignalDelivery(()=>abandonExpiredSignalDeliveriesNow()).catch(error=>console.error('No se pudieron caducar los reintentos antiguos:',error));
  createWindow();
  void importMt5CsvDatasets().catch(error=>console.warn('Importación CSV inicial no disponible:',error instanceof Error?error.message:'error desconocido'));
  historyEvaluationStartupTimer=setTimeout(()=>{
    void evaluateHistoryBatch().catch(error=>console.warn('Evaluación histórica inicial no disponible:',error instanceof Error?error.message:'error desconocido'));
  },60_000);
  historyEvaluationStartupTimer.unref?.();
  historyEvaluationTimer=setInterval(()=>{
    void evaluateHistoryBatch().catch(error=>console.warn('Evaluación histórica periódica no disponible:',error instanceof Error?error.message:'error desconocido'));
  },15*60_000);
  historyEvaluationTimer.unref?.();
  signalRetryTimer=setInterval(()=>{void retryPendingSignalDeliveries(10).catch(error=>console.warn('Reintento de avisos pendiente:',error instanceof Error?error.message:'error desconocido'))},2*60_000);
  signalRetryTimer.unref?.();
  const collectorStore=sentinelOperationalStore(),collectorCheckpoint=await collectorStore.readCollectorState();
  operationalHealthScheduler=createOperationalHealthScheduler({task:()=>refreshOperationalHealth(),intervalMs:15*60_000,startupDelayMs:30_000,minimumGapMs:5*60_000,maximumBackoffMs:4*60*60_000,initialState:collectorCheckpoint,onState:state=>collectorStore.saveCollectorState(state)});
  operationalHealthScheduler.start();
  powerMonitor.on('resume',()=>{void operationalHealthScheduler?.resume()});
  dailyReportScheduler=createDailyClockScheduler({task:()=>sendDailyReport(),utcHour:DAILY_REPORT_UTC_HOUR,utcMinute:DAILY_REPORT_UTC_MINUTE,onState:state=>{dailyReportSchedulerState=state}});
  if((await readDailyReportConfig()).enabled)dailyReportScheduler.start();
  const icon=nativeImage.createFromPath(process.execPath).resize({width:16,height:16});tray=new Tray(icon);tray.setToolTip('SentinelQuants · vigilancia activa');tray.setContextMenu(Menu.buildFromTemplate([{label:'Abrir Sentinel',click:()=>{const win=BrowserWindow.getAllWindows()[0];if(win){win.show();win.focus()}else createWindow()}},{label:'Salir',click:()=>{quitting=true;app.quit()}}]));tray.on('double-click',()=>{const win=BrowserWindow.getAllWindows()[0];win?.show()});
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('before-quit',()=>{quitting=true;clearTimeout(historyEvaluationStartupTimer);clearInterval(historyEvaluationTimer);clearInterval(signalRetryTimer);operationalHealthScheduler?.stop();void persistentLogger?.write('INFO','APPLICATION_STOP',{}).catch(()=>{});for(const symbol of [...cryptoFlowMonitors.keys()])stopCryptoFlow(symbol)});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
