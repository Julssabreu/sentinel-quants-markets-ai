import { describe, expect, it } from 'vitest';
import {
  ALL_MARKETS,
  PROVIDERS,
  activeProviders,
  detectRequiredCoverageGaps,
  premiumRoadmap,
  providersForMarket,
  providersForMarketRole,
  providersForRole
} from './providerRegistry';

describe('provider registry multimercado', () => {
  it('nunca habilita gasto automático', () => {
    expect(PROVIDERS.every(provider => provider.autoSpend === false)).toBe(true);
  });

  it('declara acciones globales como mercado independiente', () => {
    expect(ALL_MARKETS).toContain('STOCK');
    expect(ALL_MARKETS).toContain('INDEX');
    expect(ALL_MARKETS).toContain('ETF');
    expect(ALL_MARKETS).toContain('OPTION');
  });

  it('mantiene activos solo los conectores de solo lectura realmente implementados', () => {
    const active = activeProviders().map(provider => provider.id);
    expect(active).toEqual(expect.arrayContaining([
      'mt5', 'binance', 'fed', 'nyfed', 'ecb', 'bls', 'treasury', 'cftc', 'forexfactory', 'gdelt'
    ]));
    expect(active).not.toContain('tradingview');
    expect(active).not.toContain('alphasense');
    expect(PROVIDERS.find(provider => provider.id === 'tradingview')?.status).toBe('AVAILABLE');
  });

  it('consulta por mercado y rol sin incluir fuentes inactivas por defecto', () => {
    const activeCryptoPrices = providersForMarketRole('CRYPTO', 'PRICE_TECHNICAL').map(provider => provider.id);
    expect(activeCryptoPrices).toEqual(expect.arrayContaining(['mt5', 'binance']));
    expect(activeCryptoPrices).not.toContain('tradingview');

    const allCryptoPrices = providersForMarketRole(
      'CRYPTO',
      'PRICE_TECHNICAL',
      { includeInactive: true }
    ).map(provider => provider.id);
    expect(allCryptoPrices).toEqual(expect.arrayContaining(['mt5', 'binance', 'tradingview']));
  });

  it('consulta proveedores por mercado o por rol', () => {
    expect(providersForMarket('STOCK').map(provider => provider.id)).toContain('mt5');
    expect(providersForRole('REGULATORY').map(provider => provider.id)).toContain('cftc');
    // EDGAR es el único proveedor activo de fundamentales: no hay alternativa gratuita
    // equivalente y las de pago siguen en REQUIRES_LICENSE.
    expect(providersForRole('FUNDAMENTAL').map(provider => provider.id)).toEqual(['sec']);
  });

  it('cierra las brechas de acciones solo con el conector EDGAR verificado', () => {
    // Antes de conectar EDGAR, FUNDAMENTAL y REGULATORY no tenían proveedor activo y
    // acciones nunca alcanzaba cobertura completa. El conector se verificó en vivo
    // contra AAPL antes de marcar el proveedor como ACTIVE.
    expect(detectRequiredCoverageGaps('STOCK')).toEqual([]);
    expect(providersForMarketRole('STOCK', 'REGULATORY').map(provider => provider.id)).toEqual(['sec']);
    expect(providersForMarketRole('STOCK', 'FUNDAMENTAL').map(provider => provider.id)).toEqual(['sec']);
  });

  it('mantiene abiertas las brechas de los mercados que EDGAR no cubre', () => {
    // EDGAR solo cubre STOCK y ETF: registrar la SEC no debe aparentar cobertura en
    // futuros ni en opciones.
    expect(providersForMarketRole('FUTURE', 'REGULATORY').map(provider => provider.id)).not.toContain('sec');
    expect(detectRequiredCoverageGaps('OPTION').map(gap => gap.role)).toContain('DERIVATIVES');
  });

  it('mantiene opciones sin voto operativo hasta disponer de datos específicos de derivados', () => {
    const gaps = detectRequiredCoverageGaps('OPTION');
    expect(gaps.map(gap => gap.role)).toContain('DERIVATIVES');
    expect(gaps.find(gap => gap.role === 'DERIVATIVES')?.inactiveCandidates).toEqual([]);
  });

  it('no confunde el disparador preparado de TradingView con cobertura activa', () => {
    expect(providersForMarketRole('STOCK', 'ALERT_TRIGGER')).toEqual([]);
    expect(
      providersForMarketRole('STOCK', 'ALERT_TRIGGER', { includeInactive: true })
        .map(provider => provider.id)
    ).toEqual(['tradingview']);
  });

  it('conserva conectores premium en la hoja de ruta sin activarlos', () => {
    const premium = premiumRoadmap();
    expect(premium.map(provider => provider.id)).toEqual(expect.arrayContaining(['x', 'reuters', 'alphasense']));
    expect(premium.every(provider => provider.status !== 'ACTIVE' && provider.autoSpend === false)).toBe(true);
  });
});
