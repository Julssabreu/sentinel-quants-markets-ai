import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Node runtime supplied by Vitest.
import fs from 'node:fs/promises';
// @ts-expect-error Node runtime supplied by Vitest.
import os from 'node:os';
// @ts-expect-error Node runtime supplied by Vitest.
import path from 'node:path';
// @ts-expect-error CommonJS production module.
import logModule from '../shared/persistentLog.cjs';
// @ts-expect-error CommonJS production module.
import trustModule from '../shared/ipcTrust.cjs';
// @ts-expect-error CommonJS production module.
import identityModule from '../shared/signalIdentity.cjs';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});

describe('Electron hardening',()=>{
  it('accepts only the main frame at the exact packaged entry or local dev origin',()=>{
    const sender:any={mainFrame:null,isDestroyed:()=>false};
    const frame:any={url:'file:///C:/Sentinel/dist/index.html'};sender.mainFrame=frame;
    const window:any={webContents:sender};
    expect(trustModule.isTrustedIpcEvent({sender,senderFrame:frame},{browserWindows:[window],packagedEntry:'C:/Sentinel/dist/index.html'})).toBe(true);
    expect(trustModule.isTrustedIpcEvent({sender,senderFrame:{url:frame.url}},{browserWindows:[window],packagedEntry:'C:/Sentinel/dist/index.html'})).toBe(false);
    frame.url='file:///C:/Sentinel/dist/other.html';
    expect(trustModule.isTrustedIpcEvent({sender,senderFrame:frame},{browserWindows:[window],packagedEntry:'C:/Sentinel/dist/index.html'})).toBe(false);
    expect(trustModule.isAllowedRendererUrl('http://localhost:5173/',{allowDevServer:true,devPort:5173})).toBe(true);
    expect(trustModule.isAllowedRendererUrl('http://localhost:5173/?token=x',{allowDevServer:true,devPort:5173})).toBe(false);
  });

  it('redacts secrets and phone numbers from persistent logs',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-log-'));roots.push(directory);
    const logger=logModule.createPersistentLogger(directory);
    await logger.write('ERROR','TEST',{consumerToken:'secret',message:'call +18095551234',nested:{password:'hidden'}});
    const content=await fs.readFile(logger.activePath,'utf8');
    expect(content).not.toContain('secret');expect(content).not.toContain('+18095551234');expect(content).not.toContain('hidden');
    expect(content).toContain('[REDACTED]');expect(content).toContain('[PHONE_REDACTED]');
  });

  it('deduplicates a provider signal independently of each analysis record',()=>{
    const first={source:'TRADINGVIEW',sourceSignalId:'TV-1',analysisRecordId:'A-1'};
    const second={source:'TRADINGVIEW',sourceSignalId:'TV-1',analysisRecordId:'A-2'};
    expect(identityModule.canonicalSignalFingerprint(first)).toBe(identityModule.canonicalSignalFingerprint(second));
    expect(identityModule.sameSignalIdentity(first,second)).toBe(true);
    expect(identityModule.parseLegacyRetryIdentity('TRADINGVIEW_VALIDATION|TV-1')).toEqual({source:'TRADINGVIEW',sourceSignalId:'TV-1'});
  });

  it('wraps every Electron IPC registration in the trusted-origin guard',async()=>{
    const source=await fs.readFile(path.resolve('electron/main.cjs'),'utf8');
    expect(source).toMatch(/const ipcMain=\{handle\(channel,listener\)\{return electronIpcMain\.handle\(channel,\(event,\.\.\.args\)=>\{assertTrustedIpc\(event\)/);
    expect(source.match(/electronIpcMain\.handle\(/g)).toHaveLength(1);
  });

  it('derives runtime versions from package metadata instead of a stale hardcoded release',async()=>{
    const [main,preload]=await Promise.all([
      fs.readFile(path.resolve('electron/main.cjs'),'utf8'),
      fs.readFile(path.resolve('electron/preload.cjs'),'utf8'),
    ]);
    expect(main).toContain('app.getVersion()');
    expect(main).toContain('additionalArguments: [`--sentinel-version=${app.getVersion()}`]');
    expect(preload).toContain("process.argv.find(value=>value.startsWith('--sentinel-version=')");
    expect(main).not.toContain('Sentinel-Markets-AI/0.4.1');
    expect(preload).not.toContain("version: '0.4.1'");
  });

  it('ships and prefers the standalone MT5 bridge for packaged installations',async()=>{
    const [main,pkg]=await Promise.all([
      fs.readFile(path.resolve('electron/main.cjs'),'utf8'),
      fs.readFile(path.resolve('package.json'),'utf8').then(JSON.parse),
    ]);
    expect(main).toContain("path.join(process.resourcesPath,'services','mt5_bridge.exe')");
    expect(main.indexOf("mt5_bridge.exe")).toBeLessThan(main.indexOf("mt5_bridge.py"));
    expect(pkg.build.extraResources).toContainEqual({from:'services/dist/mt5_bridge.exe',to:'services/mt5_bridge.exe'});
    const bridge=await fs.stat(path.resolve('services/dist/mt5_bridge.exe'));
    expect(bridge.size).toBeGreaterThan(1_000_000);
  });

  it('expires stale pending notifications on startup and audits the terminal state',async()=>{
    const main=await fs.readFile(path.resolve('electron/main.cjs'),'utf8');
    expect(main).toContain("abandonReason:'STALE_RETRY_EXPIRED'");
    expect(main).toContain("appendLedger('SENTINEL_SIGNAL_ABANDONED'");
    expect(main).toContain('serializeSignalDelivery(()=>abandonExpiredSignalDeliveriesNow())');
  });

  it('deep-verifies active and archived ledger evidence in operational health',async()=>{
    const main=await fs.readFile(path.resolve('electron/main.cjs'),'utf8');
    expect(main).toContain('timedProbe(()=>verifyLedger({deep:true}))');
  });

  it('migrates notification destinations to Windows-encrypted storage without a bundled default',async()=>{
    const [main,policy]=await Promise.all([
      fs.readFile(path.resolve('electron/main.cjs'),'utf8'),
      fs.readFile(path.resolve('shared/signalNotifierPolicy.cjs'),'utf8'),
    ]);
    expect(main).toContain('const{target,...publicFields}=normalized');
    expect(main).toContain("targetEncrypted:target?encryptLocalSecret(target):''");
    expect(main).toContain('requiresMigration=diskValue.schemaVersion!==3');
    expect(policy).toMatch(/target:\s*'',/);
    expect(policy).not.toMatch(/target:\s*['"]\+[1-9]\d{7,14}/);
  });

  it('recomputes every Quant validation in the trusted worker from durable inputs',async()=>{
    const main=await fs.readFile(path.resolve('electron/main.cjs'),'utf8');
    const validation=main.slice(main.indexOf("ipcMain.handle('quant:validation-save'"),main.indexOf("ipcMain.handle('paper:events-list'"));
    const ablation=main.slice(main.indexOf("ipcMain.handle('quant:ablation-save'"),main.indexOf("ipcMain.handle('quant:parameter-stability-save'"));
    const parameters=main.slice(main.indexOf("ipcMain.handle('quant:parameter-stability-save'"),main.indexOf('function numberAt'));
    expect(validation).toContain('runTrustedQuantStage({...context.input');
    expect(ablation).toContain("runTrustedQuantStage({...context.input,stage:'ABLATION_RUN'}");
    expect(parameters).toContain('runTrustedParameterStability({...context.input');
    expect(`${validation}${ablation}${parameters}`).not.toMatch(/payload\?\.(output|records|statistics|models)/);
  });

  it('exposes bounded MT5 recovery and independent runtime health components',async()=>{
    const [main,preload,bridge]=await Promise.all([
      fs.readFile(path.resolve('electron/main.cjs'),'utf8'),
      fs.readFile(path.resolve('electron/preload.cjs'),'utf8'),
      fs.readFile(path.resolve('services/mt5_bridge.py'),'utf8'),
    ]);
    expect(main).toContain("ipcMain.handle('mt5:rates-after'");
    expect(main).toContain("'--until',new Date(parsedUntil).toISOString()");
    expect(preload).toContain("invoke('mt5:rates-after', symbol, timeframe, after, count, until)");
    expect(bridge).toContain('"liveOrderSent": False');
    expect(bridge).toContain('"executionAuthorized": False');
    expect(main).toContain("component('AUTONOMOUS_RUNTIME',true,true");
    expect(main).toContain("component('PAPER_RUNTIME',true,true");
    expect(main).toContain("component('SHADOW_RUNTIME',true,true");
    expect(main).toContain('liveEnabled:false,liveOrderSent:false,executionAuthorized:false');
  });
});
