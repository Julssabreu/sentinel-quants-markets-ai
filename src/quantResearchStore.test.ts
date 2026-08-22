import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Node runtime is supplied by Vitest; frontend tsconfig intentionally excludes Node globals.
import fs from 'node:fs/promises';
// @ts-expect-error Node runtime is supplied by Vitest; frontend tsconfig intentionally excludes Node globals.
import os from 'node:os';
// @ts-expect-error Node runtime is supplied by Vitest; frontend tsconfig intentionally excludes Node globals.
import path from 'node:path';
// @ts-expect-error CommonJS production module
import researchStore from '../shared/quantResearchStore.cjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive:true, force:true }); });
describe('append-only Quant research store', () => {
  it('persists idempotently and rejects historical mutation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-quant-store-')); roots.push(root);
    const store = researchStore.createQuantResearchStore(root);
    expect((await store.append('dataset', { datasetId:'D-1', checksum:'abc' })).created).toBe(true);
    expect((await store.append('dataset', { datasetId:'D-1', checksum:'abc' })).duplicate).toBe(true);
    await expect(store.append('dataset', { datasetId:'D-1', checksum:'changed' })).rejects.toThrow(/inmutables/);
    expect(await store.verify('dataset')).toMatchObject({ ok:true, entries:1 });
  });
  it('detects a modified append-only record', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-quant-store-')); roots.push(root);
    const store = researchStore.createQuantResearchStore(root);
    await store.append('experiment', { experimentId:'Q-1', result:'PASSED' });
    const file = path.join(root, 'experiment.jsonl'), entry = JSON.parse(await fs.readFile(file, 'utf8'));
    entry.payload.result = 'CHANGED'; await fs.writeFile(file, `${JSON.stringify(entry)}\n`);
    expect(await store.verify('experiment')).toMatchObject({ ok:false, brokenAt:1 });
  });
  it('supports deterministic timestamps and lookup by immutable id', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-quant-store-')); roots.push(root);
    const store = researchStore.createQuantResearchStore(root, { now:() => new Date('2026-01-01T00:00:00Z') });
    await store.append('setup', { setupId:'S-1', resultR:null });
    expect(await store.get('setup', 'S-1')).toMatchObject({ id:'S-1', createdAt:'2026-01-01T00:00:00.000Z' });
    expect(await store.get('setup', 'missing')).toBeNull();
  });
  it('rejects an arbitrary renderer backtest summary that does not match durable setups',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-quant-store-'));roots.push(root);
    const store=researchStore.createQuantResearchStore(root,{now:()=>new Date('2026-01-01T00:00:00Z')});
    await store.append('dataset',{datasetId:'D-1',checksum:'dataset-checksum'});
    await store.append('experiment',{experimentId:'Q-TRUST',datasetId:'D-1',config:{risk:{riskPercent:.5}}});
    const base={resultId:'BACKTEST:Q-TRUST',experimentId:'Q-TRUST',datasetId:'D-1',datasetChecksum:'dataset-checksum',computationAuthority:'SENTINEL_BACKEND_V1',status:'COMPLETED',result:{experimentId:'Q-TRUST',trades:[],candidates:[],grossR:0,netR:0,riskPercent:.5,riskModel:'FIXED_FRACTION_NON_COMPOUNDED',grossReturnPercent:0,netReturnPercent:0},statistics:{sampleSize:0,returns:[]}};
    await expect(store.append('result',{...base,statistics:{sampleSize:99,returns:[]}})).rejects.toThrow(/sampleSize/);
    await expect(store.append('result',{...base,computationAuthority:null})).rejects.toThrow(/backend confiable/);
    expect((await store.append('result',base)).created).toBe(true);
    const derived={resultId:'OUT_OF_SAMPLE:Q-TRUST',experimentId:'Q-TRUST',datasetId:'D-1',datasetChecksum:'dataset-checksum',stage:'OUT_OF_SAMPLE',status:'COMPLETED',output:{status:'COMPLETED'}};
    await expect(store.append('result',derived)).rejects.toThrow(/backend confiable/);
    expect((await store.append('result',{...derived,computationAuthority:'SENTINEL_BACKEND_V1'})).created).toBe(true);
    const diagnosticMethodology={claim:'DIAGNOSTIC_ONLY_NOT_TRAIN_TEST_WALK_FORWARD',parameterRefit:false,modelRetrainedPerFold:false};
    await expect(store.append('result',{...derived,resultId:'WALK_FORWARD:Q-TRUST',stage:'WALK_FORWARD',computationAuthority:'SENTINEL_BACKEND_V1',output:{methodology:diagnosticMethodology,validation:{stable:true}}})).rejects.toThrow(/walk-forward bloqueado/);
    await expect(store.append('result',{...derived,resultId:'WALK_FORWARD:Q-TRUST',stage:'WALK_FORWARD',computationAuthority:'SENTINEL_BACKEND_V1',output:{methodology:diagnosticMethodology,validation:{stable:false}}})).rejects.toThrow(/walk-forward bloqueado/);
  });
  it('serializes append operations across independent store instances for the same root',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-quant-store-'));roots.push(root);
    const first=researchStore.createQuantResearchStore(root),second=researchStore.createQuantResearchStore(root);
    await Promise.all(Array.from({length:20},(_,index)=>(index%2?first:second).append('dataset',{datasetId:`D-${index}`,checksum:`C-${index}`})));
    expect(await first.verify('dataset')).toMatchObject({ok:true,entries:20});
  });
  it('hashes the exact JSON payload written to disk when optional fields are undefined',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-quant-store-'));roots.push(root);
    const store=researchStore.createQuantResearchStore(root);
    const stored=await store.append('dataset',{datasetId:'D-NORMALIZED',checksum:'abc',optional:undefined});
    expect(stored.entry.payload).not.toHaveProperty('optional');
    expect(await store.verify('dataset')).toMatchObject({ok:true,entries:1});
    expect((await store.append('dataset',{datasetId:'D-NORMALIZED',checksum:'abc'})).duplicate).toBe(true);
  });
});
