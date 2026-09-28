// api/sessions.js — API route. Delegates all DB work to mongo.js.
const mongo = require('./mongo');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ---- Health check: /api/sessions?action=health ----
    if (req.method === 'GET' && req.query.action === 'health') {
      const r = await mongo.health();
      return res.json(r);
    }

    // ---- List all sessions ----
    if (req.method === 'GET') {
      const sessions = await mongo.listSessions();
      return res.json({ sessions });
    }

    // ---- Create new session (called on START) ----
    // ---- OR append result batch: /api/sessions?action=save ----
    if (req.method === 'POST') {
      if (req.query.action === 'save') {
        const { sessionId, entries } = req.body || {};
        const r = await mongo.saveEntries(sessionId, entries);
        return res.json(r);
      }
      const doc = await mongo.createSession(req.body || {});
      return res.json(doc);
    }

    // ---- Update session (edit fields / mark stopped) ----
    if (req.method === 'PATCH') {
      const { id, ...patch } = req.body || {};
      const r = await mongo.updateSession(id, patch);
      return res.json(r);
    }

    // ---- Delete session ----
    if (req.method === 'DELETE') {
      const r = await mongo.deleteSession(req.query.id);
      return res.json(r);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports.config = { maxDuration: 60 };
