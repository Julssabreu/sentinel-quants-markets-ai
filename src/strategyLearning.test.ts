import { describe, expect, it } from 'vitest';
import { evaluateStrategy } from './strategyLearning';
import type { PerformanceStats } from './performanceStats';
const stats=(overrides:Partial<PerformanceStats>={}):PerformanceStats=>({total:40,resolved:40,wins:20,losses:20,ambiguous:0,activationRate:80,winRate:50,netR:30,averageR:.75,profitFactor:2.5,maxDrawdownR:5,sampleWarning:null,...overrides});
describe('strategy learning',()=>{
  it('no promueve con muestra pequeña',()=>expect(evaluateStrategy(stats({resolved:10}),.3).verdict).toBe('INSUFFICIENT_SAMPLE'));
  it('rechaza expectativa negativa',()=>expect(evaluateStrategy(stats({averageR:-.1,netR:-4,profitFactor:.8}),.3).proposedWeight).toBe(0));
  it('solo propone, nunca activa automáticamente',()=>expect(evaluateStrategy(stats(),.3).requiresApproval).toBe(true));
});
