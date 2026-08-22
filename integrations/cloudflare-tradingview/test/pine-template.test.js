import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const templateUrl = new URL('../templates/SentinelMarketObserver.pine', import.meta.url);

test('SMO v2 makes alert diagnostics visible and never gates alert() on the secret', async () => {
  const source = await readFile(templateUrl, 'utf8');

  assert.match(source, /indicator\("Sentinel Market Observer v2", "SMO v2", overlay=true\)/);
  assert.match(source, /secretOk = str\.length\(secret\) >= 32/);
  assert.match(
    source,
    /shouldAlert = sendClosedBars and marketAllowed and barstate\.isrealtime and barstate\.isconfirmed/,
  );
  assert.match(source, /if shouldAlert\s+[\s\S]*alert\(message, alert\.freq_once_per_bar_close\)/);
  assert.doesNotMatch(source, /shouldAlert\s*=.*secretOk/);
  assert.match(source, /"CARGADO" : "VACIO\/CORTO"/);
  assert.match(source, /"LISTO; ESPERA CIERRE"/);
});
