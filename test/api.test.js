const assert = require('assert');
const http = require('http');
const app = require('../src/server');

// Helper to make local HTTP requests to the Express app
function makeRequest({ method, path, headers = {}, body = null, port }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const requestHeaders = { ...headers };
    if (serializedBody && !requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    if (serializedBody) {
      requestHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: requestHeaders
      },
      (res) => {
        let responseData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedJson = null;
          try {
            parsedJson = JSON.parse(responseData);
          } catch {
            // Keep raw if not json
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedJson,
            rawBody: responseData
          });
        });
      }
    );

    req.on('error', reject);

    if (serializedBody) {
      req.write(serializedBody);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting ACME AI Backend Test Suite ---');
  let passed = 0;
  let failed = 0;

  // Start test server on random ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  try {
    // 1. Health check test
    await test('GET /api/health returns 200 with success status', async () => {
      const res = await makeRequest({ method: 'GET', path: '/api/health', port });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.message, 'ACME AI Backend is running');
    });

    // 2. Chat missing message property
    await test('POST /api/chat rejects empty body / missing message with 400', async () => {
      const res = await makeRequest({
        method: 'POST',
        path: '/api/chat',
        body: {},
        port
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'MISSING_MESSAGE');
    });

    // 3. Chat with empty string
    await test('POST /api/chat rejects empty string message with 400', async () => {
      const res = await makeRequest({
        method: 'POST',
        path: '/api/chat',
        body: { message: '' },
        port
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'EMPTY_MESSAGE');
    });

    // 4. Chat with whitespace-only message
    await test('POST /api/chat rejects whitespace-only message with 400', async () => {
      const res = await makeRequest({
        method: 'POST',
        path: '/api/chat',
        body: { message: '    \n\t  ' },
        port
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'EMPTY_MESSAGE');
    });

    // 5. Chat with non-string message
    await test('POST /api/chat rejects non-string message with 400', async () => {
      const res = await makeRequest({
        method: 'POST',
        path: '/api/chat',
        body: { message: 12345 },
        port
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'INVALID_MESSAGE_TYPE');
    });

    // 6. Chat with malformed JSON
    await test('POST /api/chat rejects malformed JSON with 400 INVALID_JSON', async () => {
      const res = await makeRequest({
        method: 'POST',
        path: '/api/chat',
        headers: { 'Content-Type': 'application/json' },
        body: '{"message": "incomplete json',
        port
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'INVALID_JSON');
    });

    // 7. Chat with valid message when AI runtime is unconfigured
    await test('POST /api/chat honestly returns 503 when local AI runtime is unconfigured', async () => {
      const res = await makeRequest({
        method: 'POST',
        path: '/api/chat',
        body: { message: 'Hello, ACME AI' },
        port
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'AI_SERVICE_UNAVAILABLE');
      assert.ok(res.body.error.message.includes('Local AI runtime endpoint is not configured'));
    });

    // 8. Chat when AI runtime is configured but unreachable (e.g. port 11434 not listening)
    await test('POST /api/chat handles connection errors safely when runtime is unreachable', async () => {
      process.env.AI_RUNTIME_URL = 'http://127.0.0.1:11434';
      try {
        const res = await makeRequest({
          method: 'POST',
          path: '/api/chat',
          body: { message: 'Hello ACME AI' },
          port
        });
        assert.strictEqual(res.statusCode, 503);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.error.code, 'AI_SERVICE_UNAVAILABLE');
        assert.ok(res.body.error.message.includes('Unable to connect to local AI runtime'));
      } finally {
        process.env.AI_RUNTIME_URL = '';
      }
    });

    // 9. Unknown route 404 test
    await test('GET /api/nonexistent returns 404 NOT_FOUND', async () => {
      const res = await makeRequest({ method: 'GET', path: '/api/nonexistent', port });
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });

    // 10. CORS allowed origin header verification
    await test('CORS headers allow configured origin', async () => {
      const res = await makeRequest({
        method: 'GET',
        path: '/api/health',
        headers: { Origin: 'http://localhost:5173' },
        port
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5173');
    });

    // 11. CORS rejection for unlisted origin in production mode
    await test('CORS policy rejects unauthorized origins', async () => {
      const res = await makeRequest({
        method: 'GET',
        path: '/api/health',
        headers: { Origin: 'http://malicious-site.example.com' },
        port
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CORS_NOT_ALLOWED');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n--- Test Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
