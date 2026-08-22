const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const SECRET_KEY = /(authorization|cookie|password|secret|token|target|phone|credential|consumer)/i;
const PHONE_PATTERN = /\+[1-9]\d{7,14}/g;

function redact(value, key = '', seen = new WeakSet()) {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return value.replace(PHONE_PATTERN, '[PHONE_REDACTED]').slice(0, 4000);
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: redact(value.stack || '') };
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, '', seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, child]) => [childKey, redact(child, childKey, seen)]));
  }
  return value;
}

function createPersistentLogger(root, options = {}) {
  const activePath = path.join(root, 'sentinel.log.jsonl');
  const maxBytes = Math.max(64 * 1024, Number(options.maxBytes) || 5 * 1024 * 1024);
  const maxArchives = Math.max(1, Number(options.maxArchives) || 10);
  const now = options.now || (() => new Date());
  let queue = Promise.resolve();
  let consoleRestore = null;

  async function rotateIfNeeded(nextBytes) {
    let stat;
    try { stat = await fs.stat(activePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stat || stat.size + nextBytes <= maxBytes) return;
    const archive = path.join(root, `sentinel-${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.log.jsonl`);
    await fs.rename(activePath, archive);
    const archives = (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^sentinel-.*\.log\.jsonl$/.test(entry.name))
      .map(entry => entry.name)
      .sort()
      .reverse();
    for (const expired of archives.slice(maxArchives)) await fs.unlink(path.join(root, expired)).catch(() => {});
  }

  function write(level, event, details = {}) {
    const task = queue.then(async () => {
      await fs.mkdir(root, { recursive: true });
      const record = {
        schemaVersion: 1,
        timestamp: now().toISOString(),
        level: String(level || 'INFO').toUpperCase(),
        event: String(event || 'APPLICATION_EVENT').slice(0, 160),
        details: redact(details),
      };
      const line = `${JSON.stringify(record)}\n`;
      await rotateIfNeeded(Buffer.byteLength(line));
      await fs.appendFile(activePath, line, 'utf8');
      return record;
    });
    queue = task.catch(() => {});
    return task;
  }

  function captureConsole(consoleObject = console) {
    if (consoleRestore) return consoleRestore;
    const originals = {};
    for (const [method, level] of [['warn', 'WARN'], ['error', 'ERROR']]) {
      originals[method] = consoleObject[method].bind(consoleObject);
      consoleObject[method] = (...args) => {
        originals[method](...args);
        void write(level, `CONSOLE_${level}`, { arguments: args }).catch(() => {});
      };
    }
    consoleRestore = () => {
      for (const [method] of [['warn'], ['error']]) consoleObject[method] = originals[method];
      consoleRestore = null;
    };
    return consoleRestore;
  }

  return { activePath, write, captureConsole, redact };
}

module.exports = { redact, createPersistentLogger };
