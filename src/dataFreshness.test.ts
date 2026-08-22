import{describe,expect,it}from'vitest';import{assessTickFreshness}from'./dataFreshness';
describe('tick freshness',()=>{
  const now=new Date('2026-08-02T06:00:00Z');
  it('acepta tick reciente',()=>expect(assessTickFreshness('2026-08-02T05:55:00Z',now).fresh).toBe(true));
  it('bloquea tick viejo',()=>expect(assessTickFreshness('2026-08-01T23:00:00Z',now).fresh).toBe(false));
  it('bloquea hora inválida',()=>expect(assessTickFreshness(null,now).fresh).toBe(false));
  it('bloquea un tick futuro en vez de marcarlo como fresco',()=>{const result=assessTickFreshness('2026-08-02T09:00:00Z',now);expect(result.fresh).toBe(false);expect(result.clockSkewMinutes).toBe(180);expect(result.reason).toContain('futuro')});
  it('no tolera un minuto futuro como dato fresco',()=>expect(assessTickFreshness('2026-08-02T06:01:00Z',now).fresh).toBe(false));
  it('tolera solo dos segundos de deriva de reloj',()=>expect(assessTickFreshness('2026-08-02T06:00:01Z',now).fresh).toBe(true));
});
