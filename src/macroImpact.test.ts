import {describe,expect,it} from 'vitest';import {yieldCurveImpacts} from './macroImpact';
const curve:YieldCurve={date:'2026-01-01',y2:4.5,y5:4.2,y10:4,y30:4.3,spread10y2y:-.5,shape:'INVERTIDA',source:'Treasury',sourceUrl:''};
describe('macro impact',()=>it('trata el impacto como hipótesis y no certeza',()=>{const r=yieldCurveImpacts(curve);expect(r.find(x=>x.asset==='BTC')?.direction).toBe('MIXTO');expect(Math.max(...r.map(x=>x.confidence))).toBeLessThan(80)}));
