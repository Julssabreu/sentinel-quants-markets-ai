import { describe,expect,it } from 'vitest';
import { analyzeMultiTimeframe } from './multiTimeframeAnalysis';
const candles=(up:boolean)=>Array.from({length:100},(_,i)=>{const close=100+(up?i:-i)*.2;return {time:new Date(1700000000000+i*60000).toISOString(),open:close-.05,high:close+.2,low:close-.2,close,tickVolume:100,spread:10,realVolume:0}});
describe('analyzeMultiTimeframe',()=>{
  it('da más autoridad al contexto mayor que al ruido rápido',()=>{const r=analyzeMultiTimeframe({M5:{ok:true,candles:candles(false)},H4:{ok:true,candles:candles(true)},D1:{ok:true,candles:candles(true)},W1:{ok:true,candles:candles(true)}});expect(r.bias).toBe('ALCISTA');expect(r.contradictions.length).toBeGreaterThan(0)});
  it('no inventa dirección sin datos',()=>{const r=analyzeMultiTimeframe({});expect(r.bias).toBe('NEUTRAL');expect(r.available).toBe(0);expect(r.confidence).toBe(0)});
});
