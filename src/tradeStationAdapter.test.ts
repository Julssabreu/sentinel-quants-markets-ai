import {describe,expect,it} from 'vitest';
import {
  assertTradeStationReadOnlyPath,
  TRADESTATION_SIM_BASE_URL,
  tradeStationBarsRequest,
  tradeStationQuoteRequest,
  tradeStationRequestedScopes,
} from './tradeStationAdapter';

describe('TradeStation read-only adapter contract',()=>{
  it('usa SIM y solicita MarketData sin Trade ni OptionSpreads',()=>{
    expect(TRADESTATION_SIM_BASE_URL).toBe('https://sim-api.tradestation.com/v3');
    expect(tradeStationRequestedScopes()).toEqual(['openid','offline_access','MarketData']);
    expect(tradeStationRequestedScopes()).not.toContain('Trade');
    expect(tradeStationRequestedScopes()).not.toContain('OptionSpreads');
  });

  it('construye barras de sesión extendida y solo GET',()=>{
    const request=tradeStationBarsRequest('AAPL',{interval:1,sessionTemplate:'USEQPreAndPost'});
    expect(request.method).toBe('GET');
    expect(request.readOnly).toBe(true);
    expect(request.url).toContain('sessiontemplate=USEQPreAndPost');
  });

  it('limita snapshots a 100 símbolos',()=>{
    expect(tradeStationQuoteRequest(['AAPL','MSFT']).url).toContain('AAPL%2CMSFT');
    expect(()=>tradeStationQuoteRequest(Array.from({length:101},(_,index)=>`A${index}`))).toThrow();
  });

  it('bloquea brokerage, órdenes y métodos de escritura',()=>{
    expect(()=>assertTradeStationReadOnlyPath('/brokerage/accounts/1/orders','GET')).toThrow();
    expect(()=>assertTradeStationReadOnlyPath('/marketdata/quotes/AAPL','POST')).toThrow();
  });
});
