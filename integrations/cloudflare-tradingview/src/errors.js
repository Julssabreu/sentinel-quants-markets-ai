export class RequestError extends Error {
  constructor(status, code, message, field = null) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export class ValidationError extends RequestError {
  constructor(field, message) {
    super(400, 'INVALID_PAYLOAD', message, field);
    this.name = 'ValidationError';
  }
}
