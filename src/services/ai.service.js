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
   * Estimates token count of a text string (roughly ~4 chars per token)
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Prunes an array of messages to stay safely within the model context limit (4096 tokens).
   * Reserves headroom for the new response (e.g. 1024 tokens) and keeps the most recent context.
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} maxContextTokens - Context budget (default: 4096)
   * @param {number} maxResponseBudget - Reserved tokens for completion (default: 1024)
   * @returns {Array<{role: string, content: string}>}
   */
  pruneMessagesForContext(messages, maxContextTokens = 4096, maxResponseBudget = 1024) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const availableBudget = maxContextTokens - maxResponseBudget;
    const selected = [];
    let currentTokens = 0;

    // Traverse from newest message to oldest to retain latest conversation turns
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || typeof msg.content !== 'string') continue;

      const msgTokens = this.estimateTokens(msg.content) + 4; // overhead per message
      if (selected.length > 0 && currentTokens + msgTokens > availableBudget) {
        break; // Stop including older messages once budget is reached
      }

      selected.unshift({
        role: msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user'),
        content: msg.content
      });
      currentTokens += msgTokens;
    }

    return selected;
  }

  /**
   * Sends user message / conversation history to the local AI inference engine
   * @param {string|Array<{role: string, content: string}>} messageOrMessages - Validated prompt or messages array
   * @returns {Promise<{reply: string, model: string}>}
   */
  async generateChatReply(messageOrMessages) {
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

    // Normalize messages array
    let normalizedMessages = [];
    if (Array.isArray(messageOrMessages)) {
      normalizedMessages = this.pruneMessagesForContext(messageOrMessages);
    } else if (typeof messageOrMessages === 'string') {
      normalizedMessages = [{ role: 'user', content: messageOrMessages }];
    }

    // 3. Make HTTP request with timeout handling (Node 16+ compatible without external dependencies)
    return new Promise((resolve, reject) => {
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const isChatEndpoint = parsedUrl.pathname.endsWith('/chat');
      const payloadObj = isChatEndpoint
        ? {
            model: this.modelName,
            messages: normalizedMessages,
            stream: false
          }
        : {
            model: this.modelName,
            prompt: normalizedMessages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:',
            stream: false
          };

      const requestPayload = JSON.stringify(payloadObj);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname === '/' ? '/api/chat' : parsedUrl.pathname,
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
            // Support common response structures: Ollama chat message.content, reply, response, or OpenAI choices format
            const reply =
              (parsedData.message && parsedData.message.content) ||
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
