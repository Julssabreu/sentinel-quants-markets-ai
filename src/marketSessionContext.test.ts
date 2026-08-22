import { describe, expect, it } from 'vitest';
import { getMarketSessionContext } from './marketSessionContext';

describe('market session context', () => {
  it('classifies crypto as 24/7, including weekends', () => {
    expect(getMarketSessionContext('CRYPTO', '2026-08-15T12:00:00Z').session).toBe('CRYPTO_24_7');
  });
  it('classifies the London/New York overlap for forex', () => {
    expect(getMarketSessionContext('FOREX', '2026-08-14T14:00:00Z').session).toBe('LONDON_NEW_YORK_OVERLAP');
  });
});
