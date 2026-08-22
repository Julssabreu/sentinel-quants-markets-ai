import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Node runtime supplied by Vitest.
import fs from 'node:fs/promises';
// @ts-expect-error Node runtime supplied by Vitest.
import os from 'node:os';
// @ts-expect-error Node runtime supplied by Vitest.
import path from 'node:path';
// @ts-expect-error Node runtime supplied by Vitest.
import { gunzip } from 'node:zlib';
// @ts-expect-error Node runtime supplied by Vitest.
import { promisify } from 'node:util';
// @ts-expect-error CommonJS production module.
import ledgerModule from '../shared/evidenceLedger.cjs';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
async function root(){const value=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-ledger-'));roots.push(value);return value}

describe('evidence ledger durable',()=>{
  it('serializes concurrent appends without branching the chain',async()=>{
    const directory=await root(),ledger=ledgerModule.createEvidenceLedger(directory,{maxActiveBytes:1024*1024});
    await Promise.all(Array.from({length:50},(_,index)=>ledger.append('TEST_EVIDENCE',{index})));
    expect(await ledger.verify({deep:true})).toMatchObject({ok:true,entries:50,brokenAt:null});
  });

  it('quarantines a broken chain as an exact compressed archive and starts a recovery segment',async()=>{
    const directory=await root(),active=path.join(directory,'evidence-ledger.jsonl');
    await fs.mkdir(directory,{recursive:true});
    const invalid='{"schemaVersion":1,"kind":"BROKEN","createdAt":"2026-01-01T00:00:00.000Z","previousHash":"GENESIS","payloadHash":"wrong","hash":"wrong","payload":{"value":1}}\n';
    await fs.writeFile(active,invalid,'utf8');
    const ledger=ledgerModule.createEvidenceLedger(directory);
    const status=await ledger.initialize();
    expect(status).toMatchObject({ok:true,recovered:true,entries:1});
    const archives=(await fs.readdir(ledger.paths.archiveRoot)).filter((name:string)=>name.endsWith('.jsonl.gz'));
    expect(archives).toHaveLength(1);
    const restored=(await promisify(gunzip)(await fs.readFile(path.join(ledger.paths.archiveRoot,archives[0])))).toString('utf8');
    expect(restored).toBe(invalid);
    expect(await ledger.verify({deep:true})).toMatchObject({ok:true,brokenAt:null});
    const first=JSON.parse((await fs.readFile(active,'utf8')).trim());
    expect(first).toMatchObject({kind:'LEDGER_RECOVERY_ANCHOR',previousHash:'GENESIS',payload:{archivedChainValid:false,brokenAt:1}});
    const manifest=JSON.parse((await fs.readFile(ledger.paths.manifestPath,'utf8')).trim());
    expect(manifest).toMatchObject({entries:1,rawLineCount:1,validEntries:0,brokenAt:1});
  });

  it('rotates valid evidence into immutable gzip segments without deleting it',async()=>{
    const directory=await root(),ledger=ledgerModule.createEvidenceLedger(directory,{maxActiveBytes:1024});
    for(let index=0;index<30;index++)await ledger.append('LARGE_EVIDENCE',{index,text:'x'.repeat(150)});
    expect((await fs.readdir(ledger.paths.archiveRoot)).some((name:string)=>name.endsWith('.jsonl.gz'))).toBe(true);
    expect(await ledger.verify({deep:true})).toMatchObject({ok:true});
    expect((await fs.readFile(ledger.paths.manifestPath,'utf8')).trim().split(/\r?\n/).length).toBeGreaterThan(0);
  });

  it('detects a modified historical archive during deep verification',async()=>{
    const directory=await root(),ledger=ledgerModule.createEvidenceLedger(directory,{maxActiveBytes:1024});
    for(let index=0;index<20;index++)await ledger.append('ARCHIVE_TEST',{index,text:'y'.repeat(180)});
    const archive=(await fs.readdir(ledger.paths.archiveRoot)).find((name:string)=>name.endsWith('.jsonl.gz'))!;
    await fs.appendFile(path.join(ledger.paths.archiveRoot,archive),new Uint8Array([0]));
    expect(await ledger.verify({deep:true})).toMatchObject({ok:false,reasonCode:'LEDGER_ARCHIVE_SIZE_MISMATCH'});
  });

  describe('serialización de campos opcionales', () => {
    const { stableJson } = ledgerModule;

    it('omite un campo opcional ausente en vez de rechazar la evidencia', () => {
      // Bug real observado en ejecución: `marketRoute:undefined` hacía fallar el append
      // completo, así que el análisis no llegaba ni al ledger ni al historial.
      expect(() => stableJson({ symbol:'AAPL', marketRoute:undefined })).not.toThrow();
      expect(stableJson({ symbol:'AAPL', marketRoute:undefined })).toBe(stableJson({ symbol:'AAPL' }));
    });

    it('mantiene la posición de un undefined dentro de un array', () => {
      // Omitirlo desplazaría los índices y cambiaría el significado de la evidencia.
      expect(stableJson([1, undefined, 3])).toBe('[1,null,3]');
    });

    it('sigue rechazando lo que sí es un error de programación, nombrando el campo', () => {
      expect(() => stableJson({ plan:{ evaluar:() => 1 } })).toThrow(/plan\.evaluar es una función/);
    });

    it('produce la misma huella independientemente del orden de las claves', () => {
      expect(stableJson({ b:2, a:1 })).toBe(stableJson({ a:1, b:2 }));
    });
  });
});
