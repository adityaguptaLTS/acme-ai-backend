/**
 * Centralized Error Handling Middleware for ACME AI Backend
 */

/**
 * 404 Not Found Middleware for undefined routes
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `The requested endpoint '${req.method} ${req.originalUrl}' does not exist.`
    }
  });
}

/**
 * Global Error Handler Middleware
 */
function errorHandler(err, req, res, next) {
  // Prevent double responses if headers already sent
  if (res.headersSent) {
    return next(err);
  }

  // 1. JSON Parsing Syntax Error (from express.json / body-parser)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body.'
      }
    });
  }

  // 2. Request Entity Too Large (payload size limit exceeded)
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request entity exceeds allowed payload size limit.'
      }
    });
  }

  // 3. CORS origin rejected error
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'CORS_NOT_ALLOWED',
        message: 'Origin not allowed by CORS policy.'
      }
    });
  }

  // 4. Operational errors (custom errors like AIServiceError, validation errors, etc.)
  if (err.isOperational) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || 'REQUEST_FAILED',
        message: err.message
      }
    });
  }

  // 5. Unhandled / Unexpected Server Errors (500)
  // Safe internal server log without logging sensitive prompt payloads or secrets
  console.error(`[INTERNAL_ERROR] ${req.method} ${req.originalUrl}:`, err.message || err);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred.'
    }
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
