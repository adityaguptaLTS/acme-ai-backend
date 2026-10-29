const express = require('express');
const router = express.Router();
const aiService = require('../services/ai.service');

/**
 * Validation middleware for chat request body
 */
function validateChatRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: "Request body must be a JSON object containing a 'message' property."
      }
    });
  }

  const { message } = req.body;

  if (message === undefined || message === null) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_MESSAGE',
        message: "The 'message' field is required."
      }
    });
  }

  if (typeof message !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_MESSAGE_TYPE',
        message: "The 'message' field must be a string."
      }
    });
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'EMPTY_MESSAGE',
        message: "The 'message' field must not be empty or whitespace only."
      }
    });
  }

  // Guard against excessively large message strings (e.g. > 32KB)
  if (trimmed.length > 32000) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MESSAGE_TOO_LONG',
        message: "The 'message' exceeds the maximum allowed length of 32,000 characters."
      }
    });
  }

  // Attach trimmed message to request for downstream handling
  req.validatedMessage = trimmed;
  next();
}

/**
 * POST /api/chat
 * Accepts user message, forwards to local AI runtime, returns response
 */
router.post('/', validateChatRequest, async (req, res, next) => {
  try {
    const result = await aiService.generateChatReply(req.validatedMessage);

    return res.status(200).json({
      success: true,
      data: {
        reply: result.reply,
        model: result.model
      }
    });
  } catch (err) {
    // Forward operational and unexpected errors to centralized error handler
    next(err);
  }
});

module.exports = router;
