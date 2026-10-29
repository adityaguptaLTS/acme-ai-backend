# ACME AI Backend

A modular, production-minded REST API backend built with Node.js and Express 4.x for **ACME AI**, designed to integrate with a React.js + Vite frontend and a local AI inference engine.

---

## 1. Project Purpose & Architecture

The ACME AI backend serves as an intermediary between the user-facing AI chat frontend and company infrastructure hosting local machine learning models. It manages request validation, CORS security, payload throttling, error sanitization, and connection management for local AI model inference.

### Architecture Overview

```
acme-ai-backend/
├── src/
│   ├── middleware/
│   │   └── errorHandler.js   # Centralized error handler and 404 route handling
│   ├── routes/
│   │   └── chat.routes.js     # /api/chat router with payload validation
│   ├── services/
│   │   └── ai.service.js      # Decoupled local AI inference client & health checker
│   └── server.js              # Express app initialization, CORS, body parser, and lifecycle
├── test/
│   └── api.test.js            # Automated regression and API contract test suite
├── .env                       # Local environment configuration (git-ignored)
├── .env.example               # Template environment configuration
├── .gitignore                 # Excludes secrets, dependencies, and OS artifacts
├── package.json               # Pinned dependencies & scripts
├── package-lock.json          # Deterministic dependency lockfile
└── README.md                  # System documentation and deployment runbook
```

### Key Architectural Decisions

1. **Separation of Concerns:** Route handling, input validation, AI integration, and error handling are strictly isolated into distinct modules.
2. **Deterministic & Sanitized Responses:** API responses follow a strict `{ success: boolean, data?: object, error?: { code: string, message: string } }` contract. Internal stack traces, secrets, and raw network exceptions are never exposed to clients.
3. **Dual Environment Compatibility:** The codebase is designed to run seamlessly on both development environments (Node.js 22+) and target production servers (Ubuntu 20.04 LTS running Node.js 16.20.2) without relying on version-specific runtime APIs like global `fetch`.

---

## 2. Prerequisites

| Environment | Operating System | Node.js Version | npm Version | Git Version |
| :--- | :--- | :--- | :--- | :--- |
| **Development** | Windows 10/11 | `v22.15.0` | `10.9.2` | System Default |
| **Production Target** | Ubuntu 20.04.6 LTS | `v16.20.2` | `8.19.4` | `2.25.1` |

---

## 3. Installation

Install pinned dependencies deterministically from `package-lock.json`:

```bash
# In development (installs production and devDependencies like nodemon)
npm ci

# In production on Ubuntu (installs only production dependencies)
npm ci --omit=dev
```

---

## 4. Environment Configuration

Copy `.env.example` to create `.env`:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `5181` | Port number the HTTP server listens on. |
| `NODE_ENV` | String | `development` | Runtime environment (`development` or `production`). |
| `CORS_ORIGIN` | String | `http://localhost:5173` | Comma-separated list of allowed frontend origins. In production, wildcards (`*`) are disallowed by default. |
| `REQUEST_BODY_LIMIT` | String | `1mb` | Maximum JSON request body size parsed by Express. |
| `AI_MODEL_NAME` | String | `gpt-oss-20b` | Target local model identifier. |
| `AI_RUNTIME_URL` | String | `""` *(empty)* | Base URL of the confirmed local inference engine (e.g. `http://127.0.0.1:11434` or `http://127.0.0.1:8000`). Leave blank until the local service is confirmed. |
| `AI_REQUEST_TIMEOUT_MS` | Number | `30000` | Local AI inference request timeout in milliseconds (30 seconds). |

> **Security Note:** Never commit `.env` to version control. All sensitive keys and configuration parameters must stay local or be injected via deployment environment variables.

---

## 5. Starting the Backend

### Production / Standard Mode

```bash
npm start
```
Starts `node src/server.js` on port `5181` (or the configured `PORT`).

### Development Mode (with Live Reload)

```bash
npm run dev
```
Starts `nodemon src/server.js`, automatically restarting when files in `src/` are modified.

---

## 6. API Reference & Testing

### 1. Health Check Endpoint

Verifies that the backend process is up and receiving traffic.

- **Method:** `GET`
- **Path:** `/api/health`

#### Example Request

```bash
curl -X GET http://localhost:5181/api/health
```

#### Example Response (HTTP 200)

```json
{
  "success": true,
  "message": "ACME AI Backend is running"
}
```

---

### 2. Chat Endpoint

Accepts a message from the user and delegates inference to the local AI service.

- **Method:** `POST`
- **Path:** `/api/chat`
- **Headers:** `Content-Type: application/json`

#### Example Request

```bash
curl -X POST http://localhost:5181/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, ACME AI"}'
```

#### Valid Response When AI Runtime is Active (HTTP 200)

```json
{
  "success": true,
  "data": {
    "reply": "Hello! How can I assist you today?",
    "model": "gpt-oss-20b"
  }
}
```

#### Response When AI Runtime is Not Configured (HTTP 503)

```json
{
  "success": false,
  "error": {
    "code": "AI_SERVICE_UNAVAILABLE",
    "message": "Local AI runtime endpoint is not configured. Please set AI_RUNTIME_URL once the gpt-oss-20b service is confirmed and running."
  }
}
```

#### Validation Error Responses (HTTP 400)

- **Missing message property:**
  ```json
  {
    "success": false,
    "error": {
      "code": "MISSING_MESSAGE",
      "message": "The 'message' field is required."
    }
  }
  ```
- **Empty or whitespace-only message:**
  ```json
  {
    "success": false,
    "error": {
      "code": "EMPTY_MESSAGE",
      "message": "The 'message' field must not be empty or whitespace only."
    }
  }
  ```
- **Invalid message data type:**
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_MESSAGE_TYPE",
      "message": "The 'message' field must be a string."
    }
  }
  ```
- **Malformed JSON:**
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_JSON",
      "message": "Malformed JSON payload in request body."
    }
  }
  ```

---

## 7. Running Automated Tests

Run the built-in regression test suite:

```bash
npm test
```

The test runner exercises:
- Health check `GET /api/health` status and schema.
- Input validation on `POST /api/chat` (missing fields, blank strings, non-string types, malformed JSON).
- Honest service unavailable response (HTTP 503) when `AI_RUNTIME_URL` is unconfigured.
- Graceful connection error handling when an AI runtime URL is unreachable.
- Centralized 404 handler for unknown routes.
- CORS whitelist enforcement and unauthorized origin rejection.

---

## 8. Status of Local AI Runtime Integration

- **Model Required:** `gpt-oss-20b`
- **Infrastructure Assessment:**
  - The inference runtime on the Linux server has **not yet been confirmed**.
  - `ollama` is not present in the Linux user's `PATH`.
  - Port `11434` did not have an active listener during the initial environment inspection.
- **Current Behavior:**
  - The backend maintains complete honesty and security: it **does not** return fake answers, mock responses, or hardcoded chatbot text.
  - It **does not** call external commercial APIs (such as OpenAI cloud endpoints).
  - It **does not** download heavy models or install unauthorized runtimes automatically.
  - If `AI_RUNTIME_URL` is empty or the service is unreachable, it returns a clean `503 Service Unavailable` response.
- **Next Steps for Infrastructure Team:**
  1. Deploy the designated inference runtime (e.g., vLLM, Ollama, or llama.cpp server) hosting `gpt-oss-20b` on the local infrastructure.
  2. Confirm the active listening host and port (e.g., `http://127.0.0.1:11434` or `http://127.0.0.1:8000`).
  3. Set `AI_RUNTIME_URL` in `.env` to the confirmed endpoint. The service layer (`src/services/ai.service.js`) is pre-wired to forward prompts and parse responses immediately.

---

## 9. Production Deployment Guide for Ubuntu 20.04 LTS

To deploy on Ubuntu 20.04 LTS **without altering the server's globally installed Node.js v16.20.2**:

### Step 1: Deploy Files to Server
Clone or copy the project files to the destination directory on the server (e.g., `/opt/acme-ai-backend` or `/home/ubuntu/acme-ai-backend`).

### Step 2: Install Production Dependencies
Run `npm ci` with `--omit=dev` to ensure only production dependencies are installed using Node.js 16.20.2:

```bash
cd /opt/acme-ai-backend
npm ci --omit=dev
```

### Step 3: Configure Environment Variables
Create `.env` with production values:

```bash
PORT=5181
NODE_ENV=production
CORS_ORIGIN=https://acme-ai.yourdomain.com
REQUEST_BODY_LIMIT=1mb
AI_MODEL_NAME=gpt-oss-20b
AI_RUNTIME_URL=http://127.0.0.1:11434
AI_REQUEST_TIMEOUT_MS=30000
```

### Step 4: Configure a Systemd Service (Recommended)
Create `/etc/systemd/system/acme-ai-backend.service`:

```ini
[Unit]
Description=ACME AI Backend Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/acme-ai-backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/acme-ai-backend/.env

# Security sandbox
ProtectSystem=full
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Reload systemd and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable acme-ai-backend
sudo systemctl start acme-ai-backend
sudo systemctl status acme-ai-backend
```

### Step 5: Verify Deployment
Test the health check locally on the server:

```bash
curl -X GET http://127.0.0.1:5181/api/health
```
#   a c m e - a i - b a c k e n d  
 