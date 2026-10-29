const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Custom operational error class for AI service issues
 */
class AIServiceError extends Error {
  constructor(message, code = 'AI_SERVICE_UNAVAILABLE', statusCode = 503) {
    super(message);
    this.name = 'AIServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

class AIService {
  constructor() {
    this.refreshConfig();
  }

  /**
   * Refreshes runtime configuration from environment variables
   */
  refreshConfig() {
    this.modelName = process.env.AI_MODEL_NAME || 'gpt-oss-20b';
    this.runtimeUrl = process.env.AI_RUNTIME_URL ? process.env.AI_RUNTIME_URL.trim() : '';
    const parsedTimeout = parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10);
    this.timeoutMs = Number.isInteger(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30000;
  }

  /**
   * Returns whether a local inference runtime URL is currently configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.runtimeUrl && this.runtimeUrl.length > 0);
  }

  /**
   * Returns current service runtime metadata without exposing secrets
   * @returns {object}
   */
  getRuntimeStatus() {
    return {
      configured: this.isConfigured(),
      model: this.modelName,
      status: this.isConfigured() ? 'configured' : 'unconfigured'
    };
  }

  /**
   * Sends user message to the local AI inference engine
   * @param {string} message - Validated non-empty user prompt
   * @returns {Promise<{reply: string, model: string}>}
   */
  async generateChatReply(message) {
    this.refreshConfig();

    // 1. Honesty & Safety Check:
    // If the local runtime endpoint is unconfirmed or not configured,
    // do not fabricate fake replies or guess endpoints.
    if (!this.isConfigured()) {
      throw new AIServiceError(
        'Local AI runtime endpoint is not configured. Please set AI_RUNTIME_URL once the gpt-oss-20b service is confirmed and running.',
        'AI_SERVICE_UNAVAILABLE',
        503
      );
    }

    // 2. Validate URL structure
    let parsedUrl;
    try {
      parsedUrl = new URL(this.runtimeUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new AIServiceError(
        'Invalid AI_RUNTIME_URL configuration. Protocol must be http or https.',
        'AI_CONFIGURATION_ERROR',
        500
      );
    }

    // 3. Make HTTP request with timeout handling (Node 16+ compatible without external dependencies)
    return new Promise((resolve, reject) => {
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const requestPayload = JSON.stringify({
        model: this.modelName,
        prompt: message,
        stream: false
      });

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname === '/' ? '/api/generate' : parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestPayload)
        },
        timeout: this.timeoutMs
      };

      const req = client.request(options, (res) => {
        let rawData = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          rawData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new AIServiceError(
                `Local AI runtime returned non-success status code (${res.statusCode}).`,
                'AI_UPSTREAM_ERROR',
                503
              )
            );
          }

          try {
            const parsedData = JSON.parse(rawData);
            // Support common response structures: reply, response, or OpenAI choices format
            const reply =
              parsedData.reply ||
              parsedData.response ||
              (parsedData.choices && parsedData.choices[0] && parsedData.choices[0].message && parsedData.choices[0].message.content) ||
              (parsedData.choices && parsedData.choices[0] && parsedData.choices[0].text);

            if (!reply || typeof reply !== 'string') {
              return reject(
                new AIServiceError(
                  'Local AI runtime response missing text reply format.',
                  'AI_MALFORMED_RESPONSE',
                  502
                )
              );
            }

            resolve({
              reply: reply.trim(),
              model: this.modelName
            });
          } catch {
            return reject(
              new AIServiceError(
                'Failed to parse response from local AI runtime.',
                'AI_MALFORMED_RESPONSE',
                502
              )
            );
          }
        });
      });

      // Handle socket / request timeout
      req.on('timeout', () => {
        req.destroy();
        reject(
          new AIServiceError(
            `Local AI inference request timed out after ${this.timeoutMs}ms.`,
            'AI_TIMEOUT',
            504
          )
        );
      });

      // Handle connection errors (ECONNREFUSED, ENOTFOUND, etc.)
      req.on('error', (err) => {
        // Redact any internal details, log safely
        const errorCode = err.code || 'UNKNOWN';
        reject(
          new AIServiceError(
            `Unable to connect to local AI runtime (${errorCode}). Verify that the local model service is active.`,
            'AI_SERVICE_UNAVAILABLE',
            503
          )
        );
      });

      // Write payload and close request
      req.write(requestPayload);
      req.end();
    });
  }
}

module.exports = new AIService();
