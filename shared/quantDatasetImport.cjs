const { createHash } = require('crypto');

const FRAME_MS = Object.freeze({ M1:60000,M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000 });
const STATUS_RANK = Object.freeze({ DATA_VALID:0,DATA_WARNING:1,DATA_DEGRADED:2,DATA_INVALID:3 });
const ASSET_CLASSES = new Set(['FOREX','INDEX','EQUITY','METAL','ENERGY','CRYPTO','FUTURE']);
const FOREX_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-GB',{timeZone:'Etc/GMT-3',weekday:'short'});
function stableJson(value){if(Array.isArray(value))return`[${value.map(stableJson).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;return JSON.stringify(value)}
function sha256(value){return createHash('sha256').update(value).digest('hex')}

function forexSlotIsOpen(timestamp, timeframe) {
  void timeframe;
  // JustMarkets exports server-local GMT+3 bars. In that calendar the FX week
  // runs Monday 00:00 through Friday 23:59.
  const weekday=FOREX_WEEKDAY_FORMATTER.format(new Date(timestamp));
  return weekday!=='Sat'&&weekday!=='Sun';
}
function expectedMissingIntervals(previous, timestamp, intervalMs, timeframe, assetClass) {
  const total=Math.max(0,Math.round((timestamp-previous)/intervalMs)-1);
  if(assetClass!=='FOREX'||!total)return total;
  if(total>100000)return total;
  let expected=0;
  for(let index=1;index<=total;index++)if(forexSlotIsOpen(previous+index*intervalMs,timeframe))expected++;
  return expected;
}

function trimCoarsePrefix(candles,timeframe,assetClass){
  const intervalMs=FRAME_MS[timeframe];
  if(!intervalMs||timeframe==='D1'||timeframe==='W1'||candles.length<40)return{candles,excluded:0};
  const window=Math.min(200,Math.floor((candles.length-1)/2));
  if(window<20)return{candles,excluded:0};
  const good=[];
  for(let index=1;index<candles.length;index++){
    const previous=Date.parse(candles[index-1].time),current=Date.parse(candles[index].time),delta=current-previous;
    good.push(delta>0&&(delta<=intervalMs*1.5||expectedMissingIntervals(previous,current,intervalMs,timeframe,assetClass)===0)?1:0);
  }
  let score=good.slice(0,window).reduce((sum,value)=>sum+value,0),start=score/window>=.97?0:-1;
  for(let index=1;start<0&&index+window<=good.length;index++){
    score+=good[index+window-1]-good[index-1];
    if(score/window>=.97)start=index;
  }
  if(start<=0)return{candles,excluded:0};
  return{candles:candles.slice(start),excluded:start};
}

function evaluateSeries(candles, timeframe, nowMs, assetClass='UNKNOWN') {
  const intervalMs=FRAME_MS[timeframe];
  if(!intervalMs)throw new Error(`Temporalidad no soportada para importación Quant: ${timeframe}`);
  const closedInput=candles.filter(bar=>Number.isFinite(Date.parse(bar.time))&&Date.parse(bar.time)+intervalMs<=nowMs),trimmed=trimCoarsePrefix(closedInput,timeframe,assetClass),closed=trimmed.candles;
  const issues=[];if(trimmed.excluded)issues.push({code:'COARSE_PREFIX_EXCLUDED',severity:'WARNING',index:0,timestamp:closed[0]?.time||null,excludedRows:trimmed.excluded});let previous=-Infinity;const seen=new Set();
  closed.forEach((bar,index)=>{
    const timestamp=Date.parse(bar.time),prices=[bar.open,bar.high,bar.low,bar.close];
    if(seen.has(timestamp))issues.push({code:'DUPLICATE_TIMESTAMP',severity:'ERROR',index,timestamp:bar.time});
    if(timestamp<previous)issues.push({code:'OUT_OF_ORDER',severity:'ERROR',index,timestamp:bar.time});
    if(!prices.every(Number.isFinite)||prices.some(value=>value<=0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))issues.push({code:'INVALID_OHLC',severity:'ERROR',index,timestamp:bar.time});
    if(bar.spread!=null&&(!Number.isFinite(bar.spread)||bar.spread<0))issues.push({code:'INVALID_SPREAD',severity:'ERROR',index,timestamp:bar.time});
    if([bar.tickVolume,bar.realVolume].some(value=>value!=null&&(!Number.isFinite(value)||value<0)))issues.push({code:'INVALID_VOLUME',severity:'WARNING',index,timestamp:bar.time});
    if(previous>-Infinity&&timestamp-previous>intervalMs*1.5){const missing=expectedMissingIntervals(previous,timestamp,intervalMs,timeframe,assetClass);if(missing>0)issues.push({code:'MISSING_INTERVALS',severity:'WARNING',index,timestamp:bar.time,missing})}
    seen.add(timestamp);previous=timestamp;
  });
  if(!closed.length)issues.push({code:'EMPTY_CLOSED_SERIES',severity:'ERROR',index:null,timestamp:null});
  const errors=issues.filter(issue=>issue.severity==='ERROR').length,warningRatio=issues.filter(issue=>issue.severity==='WARNING').length/Math.max(1,closed.length);
  const status=errors?'DATA_INVALID':warningRatio>.1?'DATA_DEGRADED':issues.length?'DATA_WARNING':'DATA_VALID';
  return {candles:closed,report:{timeframe,status,rows:closed.length,excludedOpenBars:candles.length-closedInput.length,excludedCoarseRows:trimmed.excluded,issues}};
}

function buildMt5DatasetBundle(input) {
  const nowMs=Date.parse(input.processingTimestamp);
  if(!Number.isFinite(nowMs))throw new Error('processingTimestamp inválido.');
  if(!ASSET_CLASSES.has(input.assetClass))throw new Error('Clase de activo inválida.');
  const requested=[...new Set(input.timeframes.map(value=>String(value).toUpperCase()))];
  const series={},reports=[];
  for(const timeframe of requested){const response=input.response?.results?.[timeframe];if(!response?.ok||!Array.isArray(response.candles)){reports.push({timeframe,status:'DATA_INVALID',rows:0,excludedOpenBars:0,issues:[{code:'SOURCE_SERIES_UNAVAILABLE',severity:'ERROR',index:null,timestamp:null}]});continue}const evaluated=evaluateSeries(response.candles,timeframe,nowMs,input.assetClass);series[timeframe]=evaluated.candles;reports.push(evaluated.report)}
  const qualityStatus=reports.reduce((worst,report)=>STATUS_RANK[report.status]>STATUS_RANK[worst]?report.status:worst,'DATA_VALID');
  const reference=requested.map(timeframe=>input.response?.results?.[timeframe]).find(response=>response?.ok),digits=Number(reference?.digits);
  const pointSize=Number.isInteger(digits)&&digits>=0&&digits<=12?10**-digits:null;
  const reportedTickSize=Number(reference?.specification?.tickSize),tickSize=Number.isFinite(reportedTickSize)&&reportedTickSize>0?reportedTickSize:null;
  const raw={schemaVersion:2,provider:'MT5',symbol:reference?.symbol||input.symbol,instrumentId:input.instrumentId,assetClass:input.assetClass,normalizationVersion:input.normalizationVersion,sourceManifest:input.response?.sourceManifest||null,pointSize,tickSize,series};
  const checksum=sha256(stableJson(raw));
  const all=Object.values(series).flat();let minimumTime=Infinity,maximumTime=-Infinity;for(const bar of all){const value=Date.parse(bar.time);if(Number.isFinite(value)){if(value<minimumTime)minimumTime=value;if(value>maximumTime)maximumTime=value}}
  const datasetId=`MT5-${input.instrumentId}-${checksum.slice(0,16)}`;
  return {raw,provenance:{schemaVersion:1,datasetId,provider:'MT5',instrumentId:input.instrumentId,symbol:raw.symbol,assetClass:input.assetClass,broker:input.broker||null,exchange:input.exchange||null,timezone:'UTC',pointSize,tickSize,dateFrom:Number.isFinite(minimumTime)?new Date(minimumTime).toISOString():null,dateTo:Number.isFinite(maximumTime)?new Date(maximumTime).toISOString():null,resolution:'MULTI_TIMEFRAME',timeframes:requested,rows:all.length,rowsByTimeframe:Object.fromEntries(requested.map(frame=>[frame,series[frame]?.length||0])),downloadTimestamp:input.processingTimestamp,processingTimestamp:input.processingTimestamp,checksum,checksumAlgorithm:'SHA256_CANONICAL_V1',normalizationVersion:input.normalizationVersion,qualityStatus,qualityReportId:`QUALITY-${checksum.slice(0,16)}`,qualityReports:reports,dataReference:`market-data/${datasetId}.json`}};
}

module.exports={buildMt5DatasetBundle,evaluateSeries,stableJson,expectedMissingIntervals,forexSlotIsOpen,trimCoarsePrefix};
