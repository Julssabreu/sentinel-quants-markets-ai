const fs = require('fs/promises');
const { createReadStream, createWriteStream } = require('fs');
const path = require('path');
const readline = require('readline');
const { createHash, randomUUID } = require('crypto');
const { createGzip, createGunzip } = require('zlib');
const { pipeline } = require('stream/promises');

const GENESIS = 'GENESIS';

function stableJson(value, path = '') {
  if (Array.isArray(value))
    // `undefined` dentro de un array sí ocupa posición: se codifica como null, igual
    // que hace JSON.stringify, para no desplazar los índices siguientes.
    return `[${value.map((item, index) => item === undefined ? 'null' : stableJson(item, `${path}[${index}]`)).join(',')}]`;
  if (value && typeof value === 'object') {
    // Un campo opcional ausente no es evidencia corrupta: se omite, como en
    // JSON.stringify. Antes, un `marketRoute:undefined` hacía fallar el append entero
    // y el análisis se perdía sin quedar registrado en ninguna parte.
    return `{${Object.keys(value).sort()
      .filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key], path ? `${path}.${key}` : key)}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  // Funciones y símbolos sí son un error de programación, no un opcional ausente, y
  // se rechazan nombrando el campo: un ledger que se niega a guardar evidencia debe
  // decir exactamente qué la invalidó.
  if (encoded === undefined)
    throw new Error(`El ledger no admite valores no serializables: ${path || '(raíz)'} es ${typeof value === 'function' ? 'una función' : String(value)}.`);
  return encoded;
}

function entryDigest(previousHash, kind, createdAt, payloadHash) {
  return createHash('sha256').update(`${previousHash}|${kind}|${createdAt}|${payloadHash}`).digest('hex');
}

async function fileSha256(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}
async function gzipRawSha256(filePath){const hash=createHash('sha256');await pipeline(createReadStream(filePath),createGunzip(),hash);return hash.digest('hex')}
async function countNonEmptyLines(filePath){let count=0;const lines=readline.createInterface({input:createReadStream(filePath,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of lines)if(line.trim())count+=1;return count}

async function verifyLedgerFile(filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: true, entries: 0, brokenAt: null, lastHash: GENESIS, lastValidHash: GENESIS, reasonCode: null, sizeBytes: 0, mtimeMs: 0 };
    }
    throw error;
  }

  let previousHash = GENESIS;
  let entries = 0;
  try {
    const lines = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      entries += 1;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return { ok: false, entries, brokenAt: entries, lastHash: previousHash, lastValidHash: previousHash, reasonCode: 'LEDGER_JSON_INVALID', sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
      }
      const payloadHash = createHash('sha256').update(stableJson(entry.payload)).digest('hex');
      const hash = entryDigest(previousHash, entry.kind, entry.createdAt, payloadHash);
      if (entry.previousHash !== previousHash || entry.payloadHash !== payloadHash || entry.hash !== hash) {
        return { ok: false, entries, brokenAt: entries, lastHash: previousHash, lastValidHash: previousHash, reasonCode: 'LEDGER_CHAIN_INVALID', sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
      }
      previousHash = entry.hash;
    }
    return { ok: true, entries, brokenAt: null, lastHash: previousHash, lastValidHash: previousHash, reasonCode: null, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    return { ok: false, entries, brokenAt: entries + 1, lastHash: previousHash, lastValidHash: previousHash, reasonCode: 'LEDGER_READ_FAILED', detail: error.message, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
  }
}

async function verifyArchiveManifest(manifestPath, archiveRoot, options = {}) {
  let content;
  try { content = await fs.readFile(manifestPath, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, archives: 0, recoveries: 0, reasonCode: null };
    throw error;
  }
  let previousManifestHash = GENESIS, archives = 0, recoveries = 0;
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    archives += 1;
    let entry;
    try { entry = JSON.parse(line); } catch { return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_MANIFEST_JSON_INVALID', brokenAt: archives }; }
    const { schemaVersion, previousManifestHash: linkedHash, manifestPayloadHash, manifestHash, ...record } = entry;
    const expectedPayloadHash = createHash('sha256').update(stableJson(record)).digest('hex');
    const expectedHash = entryDigest(previousManifestHash, 'LEDGER_ARCHIVE', record.archivedAt, expectedPayloadHash);
    if (schemaVersion !== 1 || linkedHash !== previousManifestHash || manifestPayloadHash !== expectedPayloadHash || manifestHash !== expectedHash) {
      return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_MANIFEST_CHAIN_INVALID', brokenAt: archives };
    }
    if (!record.file || path.basename(record.file) !== record.file) return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_PATH_INVALID', brokenAt: archives };
    const archivePath = path.join(archiveRoot, record.file);
    let stat;
    try { stat = await fs.stat(archivePath); } catch { return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_MISSING', brokenAt: archives }; }
    if (Number(record.compressedBytes) !== stat.size) return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_SIZE_MISMATCH', brokenAt: archives };
    if (options.deep === true && await fileSha256(archivePath) !== record.compressedSha256) return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_HASH_MISMATCH', brokenAt: archives };
    if (options.deep === true && await gzipRawSha256(archivePath) !== record.rawSha256) return { ok: false, archives, recoveries, reasonCode: 'LEDGER_ARCHIVE_RAW_HASH_MISMATCH', brokenAt: archives };
    if (record.chainValid === false) recoveries += 1;
    previousManifestHash = manifestHash;
  }
  return { ok: true, archives, recoveries, reasonCode: null, lastManifestHash: previousManifestHash };
}

function createEvidenceLedger(root, options = {}) {
  const activePath = path.join(root, options.fileName || 'evidence-ledger.jsonl');
  const archiveRoot = path.join(root, options.archiveDirectory || 'evidence-ledger-archive');
  const manifestPath = path.join(archiveRoot, 'manifest.jsonl');
  const checkpointPath = path.join(root, 'evidence-ledger-checkpoint.json');
  const maxActiveBytes = Math.max(1024, Number(options.maxActiveBytes) || 32 * 1024 * 1024);
  const now = options.now || (() => new Date());
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  let queue = Promise.resolve();
  let initialized = false;
  let state = { entries: 0, lastHash: GENESIS, sizeBytes: 0, mtimeMs: 0, recovered: false, recovery: null, archiveIntegrity: true, archives: 0, historicalRecoveries: 0 };

  function serialize(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  async function writeCheckpoint() {
    const checkpoint = { schemaVersion: 1, updatedAt: now().toISOString(), ...state };
    const temporary = `${checkpointPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(checkpoint, null, 2), 'utf8');
    await fs.rename(temporary, checkpointPath).catch(async error => {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await fs.unlink(checkpointPath).catch(() => {});
      await fs.rename(temporary, checkpointPath);
    });
  }

  async function appendManifest(record) {
    let previousManifestHash = GENESIS;
    try {
      const lines = (await fs.readFile(manifestPath, 'utf8')).split(/\r?\n/).filter(Boolean);
      if (lines.length) previousManifestHash = JSON.parse(lines.at(-1)).manifestHash;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const manifestPayloadHash = createHash('sha256').update(stableJson(record)).digest('hex');
    const manifestHash = entryDigest(previousManifestHash, 'LEDGER_ARCHIVE', record.archivedAt, manifestPayloadHash);
    const entry = { schemaVersion: 1, previousManifestHash, manifestPayloadHash, manifestHash, ...record };
    await fs.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  async function compressArchive(sourcePath, compressedPath) {
    await pipeline(createReadStream(sourcePath), createGzip({ level: 9 }), createWriteStream(compressedPath, { flags: 'wx' }));
    const [rawSha256, compressedSha256, rawStat, compressedStat] = await Promise.all([
      fileSha256(sourcePath), fileSha256(compressedPath), fs.stat(sourcePath), fs.stat(compressedPath),
    ]);
    return {
      file: path.basename(compressedPath),
      rawSha256,
      compressedSha256,
      rawBytes: rawStat.size,
      compressedBytes: compressedStat.size,
      compression: 'gzip',
    };
  }

  async function appendEntry(kind, payload, createdAt = now().toISOString()) {
    if (!/^[A-Z0-9_:-]{1,100}$/.test(String(kind))) throw new Error('Tipo de evidencia inválido.');
    const serializedPayload = stableJson(payload);
    const payloadHash = createHash('sha256').update(serializedPayload).digest('hex');
    const hash = entryDigest(state.lastHash, kind, createdAt, payloadHash);
    const entry = { schemaVersion: 1, kind, createdAt, previousHash: state.lastHash, payloadHash, hash, payload };
    const line = `${JSON.stringify(entry)}\n`;
    await fs.appendFile(activePath, line, 'utf8');
    const stat=await fs.stat(activePath);
    state.entries += 1;
    state.lastHash = hash;
    state.sizeBytes = stat.size;
    state.mtimeMs = stat.mtimeMs;
    await writeCheckpoint();
    return { hash, payloadHash, createdAt };
  }

  async function archiveActive(reason, verification) {
    await fs.mkdir(archiveRoot, { recursive: true });
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const compressedPath = path.join(archiveRoot, `evidence-ledger-${stamp}-${randomUUID().slice(0, 8)}.jsonl.gz`);
    const [archived,rawLineCount] = await Promise.all([compressArchive(activePath,compressedPath),countNonEmptyLines(activePath)]);
    const record = await appendManifest({
      archivedAt: now().toISOString(),
      reason,
      ...archived,
      entries: rawLineCount,
      rawLineCount,
      validEntries: verification.ok?rawLineCount:Math.max(0,Number(verification.brokenAt||1)-1),
      chainValid: verification.ok,
      brokenAt: verification.brokenAt,
      lastValidHash: verification.lastValidHash,
      lastHash: verification.lastHash,
    });
    await fs.unlink(activePath);
    onEvent({ level: verification.ok ? 'INFO' : 'WARN', event: 'EVIDENCE_LEDGER_ARCHIVED', record });
    return record;
  }

  async function startSegment(anchorKind, archiveRecord) {
    state = {...state,entries:0,lastHash:GENESIS,sizeBytes:0,mtimeMs:0,recovered:anchorKind==='LEDGER_RECOVERY_ANCHOR',recovery:anchorKind==='LEDGER_RECOVERY_ANCHOR'?archiveRecord:state.recovery};
    await appendEntry(anchorKind, {
      archiveFile: archiveRecord.file,
      archiveRawSha256: archiveRecord.rawSha256,
      archiveCompressedSha256: archiveRecord.compressedSha256,
      archiveEntries: archiveRecord.entries,
      archivedLastHash: archiveRecord.lastHash,
      archivedChainValid: archiveRecord.chainValid,
      brokenAt: archiveRecord.brokenAt,
      retentionPolicy: 'IMMUTABLE_GZIP_RETAIN_ALL',
    });
  }

  async function initializeNow() {
    if (initialized) return statusFromState(true);
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(archiveRoot, { recursive: true });
    const verification = await verifyLedgerFile(activePath);
    if (!verification.ok) {
      const archiveRecord = await archiveActive('CHAIN_RECOVERY', verification);
      await startSegment('LEDGER_RECOVERY_ANCHOR', archiveRecord);
      onEvent({ level: 'WARN', event: 'EVIDENCE_LEDGER_RECOVERED', brokenAt: verification.brokenAt, archiveFile: archiveRecord.file });
    } else {
      state = {...state,entries:verification.entries,lastHash:verification.lastHash,sizeBytes:verification.sizeBytes,mtimeMs:verification.mtimeMs,recovered:false,recovery:null};
      if (state.sizeBytes >= maxActiveBytes && state.entries > 0) {
        const archiveRecord = await archiveActive('SIZE_ROTATION', verification);
        await startSegment('LEDGER_SEGMENT_ANCHOR', archiveRecord);
      } else {
        await writeCheckpoint();
      }
    }
    const archives=await verifyArchiveManifest(manifestPath,archiveRoot,{deep:true});
    state.archiveIntegrity=archives.ok;state.archives=archives.archives;state.historicalRecoveries=archives.recoveries;
    initialized = true;
    return statusFromState(true);
  }

  function statusFromState(ok, extra = {}) {
    return {
      ok:ok&&state.archiveIntegrity,
      entries: state.entries,
      brokenAt: ok ? null : extra.brokenAt ?? null,
      lastHash: state.lastHash,
      sizeBytes: state.sizeBytes,
      recovered: state.recovered,
      recovery: state.recovery,
      archiveIntegrity: state.archiveIntegrity,
      archives: state.archives,
      historicalRecoveries: state.historicalRecoveries,
      archiveDirectory: archiveRoot,
      retentionPolicy: { activeMaxBytes: maxActiveBytes, archiveCompression: 'gzip', archiveDeletion: false },
      ...extra,
    };
  }

  async function verifyNow(deep = false) {
    await initializeNow();
    const archives=await verifyArchiveManifest(manifestPath,archiveRoot,{deep});
    state.archiveIntegrity=archives.ok;state.archives=archives.archives;state.historicalRecoveries=archives.recoveries;
    if(!archives.ok)return statusFromState(false,{reasonCode:archives.reasonCode,archiveBrokenAt:archives.brokenAt});
    let stat;
    try {
      stat = await fs.stat(activePath);
    } catch (error) {
      if (error.code === 'ENOENT' && state.entries === 0) return statusFromState(true);
      return statusFromState(false, { reasonCode: 'LEDGER_FILE_MISSING' });
    }
    if (!deep && stat.size === state.sizeBytes && stat.mtimeMs === state.mtimeMs) return statusFromState(true);
    const verification = await verifyLedgerFile(activePath);
    if (verification.ok) {
      state.entries = verification.entries;
      state.lastHash = verification.lastHash;
      state.sizeBytes = verification.sizeBytes;
      state.mtimeMs = verification.mtimeMs;
      await writeCheckpoint();
      return statusFromState(true);
    }
    return statusFromState(false, verification);
  }

  return {
    paths: { activePath, archiveRoot, manifestPath, checkpointPath },
    initialize: () => serialize(initializeNow),
    append: (kind, payload) => serialize(async () => {
      await initializeNow();
      if (state.sizeBytes >= maxActiveBytes && state.entries > 0) {
        const verification = await verifyLedgerFile(activePath);
        if (!verification.ok) {
          const archiveRecord = await archiveActive('CHAIN_RECOVERY', verification);
          await startSegment('LEDGER_RECOVERY_ANCHOR', archiveRecord);
        } else {
          const archiveRecord = await archiveActive('SIZE_ROTATION', verification);
          await startSegment('LEDGER_SEGMENT_ANCHOR', archiveRecord);
        }
      }
      return appendEntry(kind, payload);
    }),
    verify: (options = {}) => serialize(() => verifyNow(options.deep === true)),
    repair: () => serialize(async () => {
      await initializeNow();
      const verification = await verifyLedgerFile(activePath);
      if (verification.ok) return statusFromState(true, { repaired: false });
      const archiveRecord = await archiveActive('MANUAL_CHAIN_RECOVERY', verification);
      await startSegment('LEDGER_RECOVERY_ANCHOR', archiveRecord);
      state.recovered = true;
      state.recovery = archiveRecord;
      return statusFromState(true, { repaired: true });
    }),
  };
}

module.exports = { GENESIS, stableJson, entryDigest, verifyLedgerFile, verifyArchiveManifest, createEvidenceLedger };
