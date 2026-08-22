const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { assertQuantSetup, assertBacktestResult, assertTrustedDerivedResult } = require('./quantPersistenceGuard.cjs');

const KINDS = Object.freeze({ dataset:'datasetId', setup:'setupId', experiment:'experimentId', result:'resultId', audit:'auditId', model:'modelId' });
const ROOT_QUEUES = new Map();
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function assertKind(kind) { if (!KINDS[kind]) throw new Error(`Tipo de registro Quant no soportado: ${kind}`); }
function assertRoot(root) {
  if (!path.isAbsolute(root)) throw new Error('QuantResearchStore requiere una ruta absoluta.');
  return path.resolve(root);
}

function createQuantResearchStore(rootDirectory, options = {}) {
  const root = assertRoot(rootDirectory);
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const fileFor = kind => { assertKind(kind); return path.join(root, `${kind}.jsonl`); };
  async function list(kind) {
    try {
      const content = await fs.readFile(fileFor(kind), 'utf8');
      return content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function appendNow(kind, payload) {
    assertKind(kind);
    const serialized=JSON.stringify(payload);
    if(serialized===undefined)throw new Error(`${kind} no admite un payload no serializable.`);
    const durablePayload=JSON.parse(serialized);
    if(kind==='setup')assertQuantSetup(durablePayload);
    if(kind==='result'){const experiments=await list('experiment'),datasets=await list('dataset');assertBacktestResult(durablePayload,await list('setup'),experiments,datasets);assertTrustedDerivedResult(durablePayload,experiments,datasets)}
    const idField = KINDS[kind], id = String(durablePayload?.[idField] || '').trim();
    if (!id) throw new Error(`${kind} requiere ${idField}.`);
    const existing = await list(kind), duplicate = existing.find(entry => entry.id === id);
    const payloadHash = createHash('sha256').update(stableJson(durablePayload)).digest('hex');
    if (duplicate) {
      if (duplicate.payloadHash !== payloadHash) throw new Error(`${kind} ${id} ya existe con contenido diferente; los históricos son inmutables.`);
      return { created:false, duplicate:true, entry:duplicate };
    }
    const previousHash = existing.at(-1)?.hash ?? 'GENESIS', createdAt = now().toISOString();
    const hash = createHash('sha256').update(`${previousHash}|${kind}|${id}|${createdAt}|${payloadHash}`).digest('hex');
    const entry = { schemaVersion:1, kind, id, createdAt, previousHash, payloadHash, hash, payload:durablePayload };
    await fs.mkdir(root, { recursive:true });
    await fs.appendFile(fileFor(kind), `${JSON.stringify(entry)}\n`, 'utf8');
    return { created:true, duplicate:false, entry };
  }
  async function get(kind, id) {
    assertKind(kind);
    const normalized = String(id || '').trim();
    if (!normalized) throw new Error('La consulta requiere un identificador.');
    return (await list(kind)).find(entry => entry.id === normalized) ?? null;
  }
  function append(kind, payload) {
    const queue=ROOT_QUEUES.get(root)??Promise.resolve(),task=queue.then(() => appendNow(kind, payload));
    ROOT_QUEUES.set(root,task.catch(() => {}));
    return task;
  }
  async function verify(kind) {
    const entries = await list(kind); let previous = 'GENESIS';
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], payloadHash = createHash('sha256').update(stableJson(entry.payload)).digest('hex');
      const hash = createHash('sha256').update(`${previous}|${kind}|${entry.id}|${entry.createdAt}|${payloadHash}`).digest('hex');
      if (entry.previousHash !== previous || entry.payloadHash !== payloadHash || entry.hash !== hash)
        return { ok:false, entries:entries.length, brokenAt:index + 1, lastHash:previous };
      previous = entry.hash;
    }
    return { ok:true, entries:entries.length, brokenAt:null, lastHash:previous };
  }
  return { root, append, get, list, verify };
}

module.exports = { createQuantResearchStore, stableJson };
