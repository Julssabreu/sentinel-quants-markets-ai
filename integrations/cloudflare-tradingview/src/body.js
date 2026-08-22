import { RequestError } from './errors.js';

export const MAX_JSON_BODY_BYTES = 16 * 1024;

export async function readJsonObject(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera el límite permitido.');
    }
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo supera el límite permitido.');
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RequestError(400, 'INVALID_JSON', 'El cuerpo no contiene UTF-8 válido.');
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RequestError(400, 'INVALID_JSON', 'El cuerpo no contiene JSON válido.');
  }

  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new RequestError(400, 'INVALID_JSON', 'El cuerpo JSON debe ser un objeto.');
  }

  return value;
}
