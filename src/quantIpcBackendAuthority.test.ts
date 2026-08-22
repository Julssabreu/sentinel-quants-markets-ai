import { describe, expect, it } from 'vitest';
// @ts-expect-error Node runtime is supplied by Vitest; frontend tsconfig intentionally excludes Node globals.
import fs from 'node:fs';
// @ts-expect-error Node runtime is supplied by Vitest; frontend tsconfig intentionally excludes Node globals.
import path from 'node:path';

const source=fs.readFileSync(path.resolve('electron','main.cjs'),'utf8');
function handler(channel:string,nextChannel:string){
  const start=source.indexOf(`ipcMain.handle('${channel}'`),end=source.indexOf(`ipcMain.handle('${nextChannel}'`,start+1);
  if(start<0||end<0)throw new Error(`Handler ${channel} no encontrado.`);
  return source.slice(start,end);
}

describe('autoridad backend de persistencia Quant IPC',()=>{
  it('recalcula validaciones desde el experimento durable y conserva walk-forward como diagnóstico backend',()=>{
    const block=handler('quant:validation-save','paper:events-list');
    expect(block).toContain('loadDurableQuantComputation');
    expect(block).toContain('runTrustedQuantStage');
    expect(block).toContain('WALK_FORWARD_BLOCKED');
    expect(block).not.toMatch(/payload\??\.output/);
  });
  it('recalcula ablaciones y estabilidad paramétrica sin leer outputs del renderer',()=>{
    const ablation=handler('quant:ablation-save','quant:parameter-stability-save');
    const parameter=handler('quant:parameter-stability-save','institutional:factors');
    expect(ablation).toContain("stage:'ABLATION_RUN'");
    expect(ablation).toContain('runTrustedQuantStage');
    expect(ablation).not.toMatch(/payload\??\.output/);
    expect(parameter).toContain('runTrustedParameterStability');
    expect(parameter).not.toMatch(/payload\??\.output/);
  });
  it('persiste autoridad y checksum del bundle backend, no etiquetas suministradas por UI',()=>{
    expect(source).toContain("computationAuthority:'SENTINEL_BACKEND_V1'");
    expect(source).toContain('datasetChecksum:envelope.datasetChecksum');
    expect(source).toContain("envelope?.authority!=='SENTINEL_BACKEND_V1'");
  });
});
