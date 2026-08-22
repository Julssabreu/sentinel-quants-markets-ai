import{afterEach,describe,expect,it}from'vitest';
// @ts-expect-error Node runtime supplied by Vitest.
import fs from'node:fs/promises';
// @ts-expect-error Node runtime supplied by Vitest.
import os from'node:os';
// @ts-expect-error Node runtime supplied by Vitest.
import path from'node:path';
// @ts-expect-error CommonJS production module.
import backupStore from'../shared/quantBackupStore.cjs';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});describe('Quant backup',()=>{it('creates and verifies a checksum manifest',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-backup-')),source=path.join(root,'source'),backup=path.join(root,'backup');roots.push(root);await fs.mkdir(source);await fs.writeFile(path.join(source,'setup.jsonl'),'evidence');const manifest=await backupStore.createQuantBackup(source,backup,{now:()=>new Date('2026-01-01Z')});expect(manifest.entries).toHaveLength(1);expect(await backupStore.verifyQuantBackup(backup)).toMatchObject({ok:true,entries:1});await fs.writeFile(path.join(backup,'data','setup.jsonl'),'tampered');expect(await backupStore.verifyQuantBackup(backup)).toMatchObject({ok:false,reasonCode:'BACKUP_CHECKSUM_MISMATCH'})})});
