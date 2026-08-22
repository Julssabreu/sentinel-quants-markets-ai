const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const required=[
  {relative:'services/dist/mt5_bridge.exe',minimumBytes:1_000_000,magic:Buffer.from('MZ')},
  {relative:'integrations/mt5/SentinelAtomicReader.ex5',minimumBytes:10_000},
  {relative:'build/icon.ico',minimumBytes:1_000},
];

for(const item of required){
  const file=path.join(root,item.relative);
  if(!fs.existsSync(file))throw new Error(`Falta un artefacto obligatorio de release: ${item.relative}`);
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size<item.minimumBytes)throw new Error(`Artefacto de release inválido: ${item.relative}`);
  if(item.magic){
    const descriptor=fs.openSync(file,'r');
    try{const header=Buffer.alloc(item.magic.length);fs.readSync(descriptor,header,0,header.length,0);if(!header.equals(item.magic))throw new Error(`Cabecera inválida: ${item.relative}`)}
    finally{fs.closeSync(descriptor)}
  }
}

const bridgeSource=fs.readFileSync(path.join(root,'services','mt5_bridge.py'),'utf8');
const eaSource=fs.readFileSync(path.join(root,'integrations','mt5','SentinelAtomicReader.mq5'),'utf8');
if(/\border_send\b|\bOrderSend\b|\bCTrade\b|\bTRADE_ACTION_/i.test(`${bridgeSource}\n${eaSource}`))throw new Error('El release contiene una API de orden real no autorizada.');
if(!/InpClosedBarOnly\s*=\s*true/.test(eaSource))throw new Error('El lector Atomic no está fijado a velas cerradas.');

console.log('Entradas de release verificadas: bridge autónomo, EA cerrado e icono. Cero APIs de orden real.');
