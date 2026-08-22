import {describe,expect,it} from 'vitest';
import {independentSourceCount,scoreSource} from './sourceQuality';
const now=new Date('2026-08-02T12:00:00Z');
describe('source quality',()=>{
  it('prioriza una fuente primaria fresca y trazable',()=>{const primary=scoreSource({id:'ecb',kind:'CENTRAL_BANK',observedAt:'2026-08-02T11:59:00Z',receivedAt:'2026-08-02T12:00:00Z',direct:true,authenticated:true},now);const social=scoreSource({id:'x',kind:'SOCIAL',observedAt:'2026-08-02T11:59:00Z',receivedAt:'2026-08-02T12:00:00Z',direct:false,authenticated:false},now);expect(primary.score).toBeGreaterThan(social.score);expect(social.warnings.length).toBeGreaterThan(0)});
  it('no cuenta dos revendedores del mismo feed como fuentes independientes',()=>{expect(independentSourceCount([{id:'a',kind:'SCREENER',observedAt:'',receivedAt:'',direct:false,authenticated:false,independentGroup:'feed-1'},{id:'b',kind:'SCREENER',observedAt:'',receivedAt:'',direct:false,authenticated:false,independentGroup:'feed-1'}])).toBe(1)});
});
