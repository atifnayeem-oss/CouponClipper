/**
 * server.js
 *
 * Express server for CouponClipper.
 *
 * Routes:
 *   GET  /              — Serves public/index.html
 *   POST /clip          — Accepts { email, password }, returns { sessionId }
 *   GET  /progress/:id  — SSE stream of progress events for a session
 *
 * Sessions are stored in memory (a Map) and cleaned up after 10 minutes.
 * Credentials are never persisted — they are used only to start the Puppeteer
 * session and are discarded immediately after.
 */

'use strict';

const express    = require('express');
const path       = require('path');
const { randomUUID } = require('crypto');
const { clipCoupons } = require('./clipper');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT              = 3000;
const SESSION_TTL_MS    = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// In-memory session store
//
// Each session holds:
//   {
//     events   : Array<object>   — buffered progress events
//     listeners: Array<Function> — active SSE response flush callbacks
//     timer    : TimeoutHandle   — cleanup timer
//     done     : boolean         — true once the clipping run has finished
//   }
// ---------------------------------------------------------------------------

const sessions = new Map();

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// POST /clip
// ---------------------------------------------------------------------------

app.post('/clip', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Create a new session.
  const sessionId = randomUUID();
  const session = {
    events:    [],
    listeners: [],
    done:      false,
    timer:     null,
  };
  sessions.set(sessionId, session);

  // Schedule automatic session cleanup.
  session.timer = setTimeout(() => {
    sessions.delete(sessionId);
  }, SESSION_TTL_MS);

  // Start clipping in the background — do NOT await here so the HTTP
  // response is sent immediately with the session ID.
  clipCoupons(email, password, (event) => {
    pushEvent(sessionId, event);
  }).catch((err) => {
    // Belt-and-suspenders: clipCoupons already catches internally, but if
    // something slips through we still want clients to hear about it.
    pushEvent(sessionId, {
      type:    'error',
      message: err.message || 'Unexpected server error',
      clipped: 0,
      total:   0,
    });
  });

  // Credentials intentionally not stored — only the session ID goes out.
  return res.json({ sessionId });
});

// ---------------------------------------------------------------------------
// GET /progress/:sessionId  (Server-Sent Events)
// ---------------------------------------------------------------------------

app.get('/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // Set SSE headers.
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Helper: write a single SSE event to this response.
  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay any events that arrived before this SSE connection was established.
  for (const event of session.events) {
    send(event);
  }

  // If the session is already finished, we are done — nothing more to stream.
  if (session.done) {
    res.end();
    return;
  }

  // Register this response as an active listener so future events are
  // forwarded in real time.
  session.listeners.push(send);

  // Clean up when the client disconnects.
  req.on('close', () => {
    if (session) {
      session.listeners = session.listeners.filter((l) => l !== send);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Appends an event to the session buffer and forwards it to all active
 * SSE listeners. Marks the session as done when the event type signals
 * completion or failure.
 */
function pushEvent(sessionId, event) {
  const session = sessions.get(sessionId);
  if (!session) return; // session already expired

  session.events.push(event);

  // Forward to every connected SSE listener.
  for (const send of session.listeners) {
    try {
      send(event);
    } catch (_) { /* listener may have disconnected */ }
  }

  // Once we reach a terminal state, mark the session done so future SSE
  // connections that join late get a complete replay and then close.
  if (event.type === 'done' || event.type === 'error') {
    session.done = true;
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`CouponClipper server running at http://localhost:${PORT}`);
});
