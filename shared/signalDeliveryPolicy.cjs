const MAX_RETRY_AGE_MS=24*60*60_000;
const MAX_FUTURE_SKEW_MS=5*60_000;

function deliveryTimestamp(record){for(const field of ['sourceTimestamp','emittedAt','signalTimestamp','checkedAt','validatedAt','createdAt']){const value=Date.parse(String(record?.[field]||''));if(Number.isFinite(value))return{field,value}}return null}
function retryDelayMs(attempts){return Math.min(60*60_000,30_000*(2**Math.max(0,Math.min(7,Number(attempts)||0))))}
function classifySignalRetry(record,now=Date.now(),maxAgeMs=MAX_RETRY_AGE_MS){if(record?.deliveryStatus!=='PENDING')return{status:'TERMINAL'};const timestamp=deliveryTimestamp(record);if(!timestamp||timestamp.value>now+MAX_FUTURE_SKEW_MS||now-timestamp.value>maxAgeMs)return{status:'STALE',timestamp};const attemptedAt=Date.parse(String(record.lastDeliveryAttemptAt||record.validatedAt||''));if(Number.isFinite(attemptedAt)&&now-attemptedAt<retryDelayMs(record.deliveryAttempts))return{status:'BACKOFF',timestamp,nextEligibleAt:attemptedAt+retryDelayMs(record.deliveryAttempts)};return{status:'READY',timestamp}}
function abandonStaleSignal(record,now=new Date().toISOString()){record.deliveryStatus='ABANDONED';record.abandonedAt=now;record.abandonReason='STALE_RETRY_EXPIRED';record.retryTerminal=true;return record}

module.exports={MAX_RETRY_AGE_MS,MAX_FUTURE_SKEW_MS,deliveryTimestamp,retryDelayMs,classifySignalRetry,abandonStaleSignal};
