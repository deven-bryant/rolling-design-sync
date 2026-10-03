'use strict';

/** A service error with its HTTP status and a stable machine-readable `code`. */
class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = { HttpError };
