const express = require('express');
const cors = require('cors');
require('dotenv').config();

const chatRoutes = require('./routes/chat.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Security: Disable express fingerprint header
app.disable('x-powered-by');

// 1. Request Body Parsing Configuration
const bodyLimit = process.env.REQUEST_BODY_LIMIT || '1mb';
app.use(express.json({ limit: bodyLimit }));

// 2. CORS Configuration
const isProduction = process.env.NODE_ENV === 'production';
const rawOrigins = process.env.CORS_ORIGIN || '';
const configuredOrigins = rawOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Fallback origins permitted during local development
const defaultDevOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permit server-to-server requests or tools like curl / health probes without an Origin header
    if (!origin) {
      return callback(null, true);
    }

    // In production, reject wildcard and require strictly matched origin
    if (isProduction) {
      if (configuredOrigins.length > 0 && configuredOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: Origin '${origin}' is not authorized.`));
    }

    // In development, accept configured origins or default dev origins
    if (configuredOrigins.length > 0) {
      if (configuredOrigins.includes(origin)) {
        return callback(null, true);
      }
    } else if (defaultDevOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS: Origin '${origin}' is not authorized.`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// 3. Safe Request Logging (Redacted: Logs method, URL, status, timing. Never logs user prompt or credentials)
app.use((req, res, next) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    // Format timestamp in ISO
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// 4. API Endpoints

/**
 * GET /api/health
 * Health check endpoint indicating the backend server status
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ACME AI Backend is running'
  });
});

/**
 * Chat API Routes
 */
app.use('/api/chat', chatRoutes);

// 5. Centralized Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// 6. Server Initialization
const PORT = parseInt(process.env.PORT, 10) || 5181;

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`ACME AI Backend listening on port ${PORT} [NODE_ENV=${process.env.NODE_ENV || 'development'}]`);
  });

  // Graceful shutdown handlers
  const handleShutdown = (signal) => {
    console.log(`Received ${signal}. Shutting down ACME AI Backend gracefully...`);
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

module.exports = app;
