import {describe,expect,it} from 'vitest';import {assessEventRisk,portfolioEventRisk} from './eventRisk';
const event=(impact:string,minutes:number):MacroEvent=>({id:`x${minutes}`,title:'CPI',currency:'USD',impact,scheduledAt:new Date(Date.parse('2026-08-02T12:00:00Z')+minutes*60000).toISOString(),forecast:null,previous:null,source:'FF',sourceUrl:'',quality:'secondary'});
describe('event risk',()=>{
 it('bloquea entradas alrededor de un evento de alto impacto',()=>{const r=assessEventRisk(event('High',30),new Date('2026-08-02T12:00:00Z'));expect(r.action).toBe('BLOQUEAR_ENTRADAS');expect(r.affectedAssets).toContain('EUR/USD')});
 it('no bloquea cuando el evento está lejano',()=>expect(assessEventRisk(event('High',180),new Date('2026-08-02T12:00:00Z')).action).toBe('NORMAL'));
 it('prioriza el riesgo más severo',()=>expect(portfolioEventRisk([event('Medium',10),event('High',20)],new Date('2026-08-02T12:00:00Z'))[0].risk.action).toBe('BLOQUEAR_ENTRADAS'));
});
