import{describe,expect,it}from'vitest';
// @ts-expect-error CommonJS production module.
import flow from'../shared/cryptoFlowWindow.cjs';

describe('crypto flow rolling window',()=>{
  it('keeps only trades and liquidations from the latest fifteen minutes',()=>{
    const window=flow.createCryptoFlowWindow(),now=Date.parse('2026-08-16T12:30:00Z');
    flow.addTrade(window,{at:now-16*60_000,side:'BUY',notional:1000});
    flow.addTrade(window,{at:now-10*60_000,side:'BUY',notional:300});
    flow.addTrade(window,{at:now-5*60_000,side:'SELL',notional:100});
    flow.addLiquidation(window,{at:now-20*60_000,side:'LONG',notional:800});
    flow.addLiquidation(window,{at:now-60_000,side:'SHORT',notional:200});
    expect(flow.cryptoFlowWindowSnapshot(window,now)).toMatchObject({windowMs:900000,tradeCount:2,buyNotional:300,sellNotional:100,takerImbalance:.5,liquidationCount:1,longLiquidationNotional:0,shortLiquidationNotional:200,liquidationImbalance:1});
  });

  it('prunes again on later snapshots instead of accumulating by uptime',()=>{
    const window=flow.createCryptoFlowWindow(),start=Date.parse('2026-08-16T12:00:00Z');
    flow.addTrade(window,{at:start,side:'BUY',notional:50});
    expect(flow.cryptoFlowWindowSnapshot(window,start+14*60_000).tradeCount).toBe(1);
    expect(flow.cryptoFlowWindowSnapshot(window,start+16*60_000)).toMatchObject({tradeCount:0,buyNotional:0,sellNotional:0,takerImbalance:0});
  });
});
