import { describe, expect, it } from 'vitest';
// @ts-expect-error CommonJS production module.
import deliveryPolicy from '../shared/signalDeliveryPolicy.cjs';
// @ts-expect-error CommonJS production module.
import notifierPolicy from '../shared/signalNotifierPolicy.cjs';

describe('signal delivery retry policy',()=>{
  const now=Date.parse('2026-08-16T18:00:00.000Z');

  it('abandons pending deliveries older than 24 hours instead of sending them',()=>{
    const record:any={deliveryStatus:'PENDING',checkedAt:'2026-08-15T17:59:59.999Z',validatedAt:'2026-08-16T17:59:00.000Z'};
    expect(deliveryPolicy.classifySignalRetry(record,now)).toMatchObject({status:'STALE',timestamp:{field:'checkedAt'}});
    expect(deliveryPolicy.abandonStaleSignal(record,'2026-08-16T18:00:00.000Z')).toMatchObject({
      deliveryStatus:'ABANDONED',
      abandonReason:'STALE_RETRY_EXPIRED',
      retryTerminal:true,
    });
  });

  it('never retries records with missing or future source timestamps',()=>{
    expect(deliveryPolicy.classifySignalRetry({deliveryStatus:'PENDING'},now).status).toBe('STALE');
    expect(deliveryPolicy.classifySignalRetry({deliveryStatus:'PENDING',checkedAt:'2026-08-16T18:06:00.000Z'},now).status).toBe('STALE');
  });

  it('migrates legacy notifier settings to encrypted-schema defaults with Windows startup enabled',()=>{
    const migrated=notifierPolicy.normalizeSignalNotifier({schemaVersion:2,enabled:true,keepInTray:true,target:'+1 (809) 555-1234'});
    expect(migrated).toMatchObject({schemaVersion:3,enabled:true,keepInTray:true,startWithWindows:true,target:'+18095551234'});
    expect(notifierPolicy.normalizeSignalNotifier({startWithWindows:false}).startWithWindows).toBe(false);
    expect(notifierPolicy.defaultSignalNotifier.startWithWindows).toBe(true);
  });
});
