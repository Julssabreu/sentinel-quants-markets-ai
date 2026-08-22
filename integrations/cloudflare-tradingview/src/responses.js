const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
});

export function jsonResponse(body, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...additionalHeaders }
  });
}

export function errorResponse(status, code, message, field = null, additionalHeaders = {}) {
  const error = { code, message };
  if (field) error.field = field;
  return jsonResponse({ ok: false, error }, status, additionalHeaders);
}

export function methodNotAllowed(allowedMethods) {
  return errorResponse(
    405,
    'METHOD_NOT_ALLOWED',
    'Método no permitido.',
    null,
    { Allow: allowedMethods.join(', ') }
  );
}
