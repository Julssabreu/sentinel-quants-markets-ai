import{describe,expect,it}from'vitest';
// @ts-expect-error CommonJS production module.
import policy from'../shared/alertStorePolicy.cjs';

describe('alert store policy',()=>{
  it('renueva todos los campos y la expiración de una alerta activa',()=>{
    const records:any[]=[{id:'A1',fingerprint:'F1',category:'DATA',severity:'INFO',symbol:null,title:'viejo',details:'viejo',source:'old',expiresAt:'2026-01-01Z',createdAt:'2026-01-01Z',lastSeenAt:'2026-01-01Z',count:1,status:'ACTIVE',schemaVersion:1}];
    const result=policy.upsertAlertCandidates(records,[{fingerprint:'F1',category:'MACRO',severity:'CRITICA',symbol:'EURUSD',title:'nuevo',details:'detalle nuevo',source:'Fed',expiresAt:'2026-08-17T12:00:00Z'}],{now:'2026-08-16T12:00:00Z',createId:()=> 'unused'});
    expect(result[0]).toMatchObject({id:'A1',category:'MACRO',severity:'CRITICA',symbol:'EURUSD',title:'nuevo',details:'detalle nuevo',source:'Fed',expiresAt:'2026-08-17T12:00:00Z',lastSeenAt:'2026-08-16T12:00:00Z',count:2,status:'ACTIVE'});
  });
});
