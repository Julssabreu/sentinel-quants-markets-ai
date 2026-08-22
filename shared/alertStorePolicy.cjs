function candidateFields(candidate){return{
  fingerprint:String(candidate.fingerprint),
  category:candidate.category,
  severity:candidate.severity,
  symbol:candidate.symbol??null,
  title:String(candidate.title),
  details:String(candidate.details||''),
  source:String(candidate.source||''),
  expiresAt:candidate.expiresAt??null,
}}

function upsertAlertCandidates(records,incoming,options={}){
  if(!Array.isArray(records)||!Array.isArray(incoming))throw new Error('Alertas inválidas.');
  const now=String(options.now||new Date().toISOString()),createId=options.createId||(()=>{throw new Error('Falta generador de identificadores.')}),output=[...records];
  for(const candidate of incoming){
    if(!candidate?.fingerprint||!candidate?.title)continue;
    const fields=candidateFields(candidate),existing=output.find(item=>item.fingerprint===fields.fingerprint&&item.status==='ACTIVE');
    if(existing){Object.assign(existing,fields,{lastSeenAt:now,count:(Number(existing.count)||1)+1})}
    else output.unshift({...fields,id:createId(),createdAt:now,lastSeenAt:now,count:1,status:'ACTIVE',schemaVersion:1});
  }
  return output;
}

module.exports={candidateFields,upsertAlertCandidates};
