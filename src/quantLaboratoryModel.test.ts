import { describe, expect, it } from 'vitest';
import { createDefaultQuantLaboratoryConfig, createQuantResearchRunRequest, synchronizeQuantConfigWithDataset, validateQuantLaboratoryConfig } from './quantLaboratoryModel';

describe('quantLaboratoryModel', () => {
  it('prepara SMC en modo seguro', () => {
    const request = createQuantResearchRunRequest(createDefaultQuantLaboratoryConfig(), '2026-08-15T12:00:00.000Z');
    expect(request.mode).toBe('ANALYSIS_ONLY');
    expect(request.strategy).toBe('SMC');
  });
  it('rechaza configuración inválida', () => {
    const config = createDefaultQuantLaboratoryConfig();
    config.dateFrom = config.dateTo; config.execution.spreadBps = -1; config.risk.riskPercent = 8; config.timeframes.trigger = 'H4';
    expect(validateQuantLaboratoryConfig(config)).toEqual(expect.arrayContaining(['LAB_DATE_RANGE_INVALID', 'LAB_COST_INVALID', 'LAB_RISK_INVALID', 'LAB_TIMEFRAME_ORDER_INVALID']));
  });
  it('sincroniza identidad, clase y rango al seleccionar BTC sin conservar EURUSD',()=>{
    const result=synchronizeQuantConfigWithDataset(createDefaultQuantLaboratoryConfig(),{symbol:'BTCUSD',assetClass:'CRYPTO',dateFrom:'2024-01-02T00:00:00.000Z',dateTo:'2026-08-15T23:55:00.000Z'});
    expect(result).toMatchObject({symbol:'BTCUSD',assetClass:'CRYPTO',dateFrom:'2024-01-02',dateTo:'2026-08-15'});
    expect(validateQuantLaboratoryConfig(result)).not.toContain('LAB_DATE_RANGE_INVALID');
  });
});
