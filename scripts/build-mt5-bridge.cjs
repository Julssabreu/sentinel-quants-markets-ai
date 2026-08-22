const path=require('path');
const {spawnSync}=require('child_process');

const services=path.resolve(__dirname,'..','services');
const result=spawnSync('python',['-m','PyInstaller','--clean','--noconfirm','mt5_bridge.spec'],{cwd:services,stdio:'inherit',windowsHide:true,shell:false});
if(result.error){console.error(`No se pudo iniciar PyInstaller: ${result.error.message}`);process.exit(1)}
if(result.status!==0)process.exit(result.status??1);
console.log(path.join(services,'dist','mt5_bridge.exe'));
