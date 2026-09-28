// api/pair.js — Pairing forwarder + MongoDB persistence.
// Path is hardcoded to /code (the real pairing endpoint).
// All DB operations are done via ?action=... query param.

const { MongoClient, ObjectId } = require('mongodb');

// ⬇⬇⬇ TUMHARI MongoDB URI (already inserted) ⬇⬇⬇
const MONGODB_URI = 'mongodb+srv://wobeg25858_db_user:meUtccsHuApHc4Vw@cluster0.oy0ymlq.mongodb.net/?appName=Cluster0';
const DB_NAME = 'pairStress';
const COLLECTION = 'sessions';

let client = null;
let db = null;

async function getDb() {
  if (db) return db;
  if (!client) {
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000
    });
    await client.connect();
  }
  db = client.db(DB_NAME);
  return db;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ========================================================
  // DB ACTIONS (via ?action=xxx)
  // ========================================================
  const action = req.query.action;

  try {
    // ---- HEALTH ----
    if (action === 'health') {
      try { await getDb(); return res.json({ ok: true }); }
      catch (e) { return res.json({ ok: false, error: e.message }); }
    }

    // ---- LIST SESSIONS ----
    if (action === 'list' && req.method === 'GET') {
      const db = await getDb();
      const sessions = await db.collection(COLLECTION)
        .find({}, { projection: { results: 0 } })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray();
      return res.json({ sessions });
    }

    // ---- GET SINGLE SESSION (with all its results) ----
    if (action === 'get' && req.method === 'GET') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const db = await getDb();
      const doc = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
      if (!doc) return res.status(404).json({ error: 'not found' });
      return res.json(doc);
    }

    // ---- CREATE SESSION ----
    if (action === 'create' && req.method === 'POST') {
      const db = await getDb();
      const b = req.body || {};
      const doc = {
        servers: Array.isArray(b.servers) ? b.servers : [],
        numbers: Array.isArray(b.numbers) ? b.numbers : [],
        path: '/code',                      // fixed
        session: b.session || 'default',
        mode: b.mode || 'unlimited',        // 'unlimited' | 'fast' | 'slow'
        concurrency: b.concurrency || 1,
        delay: b.delay || 0,
        unlimited: !!b.unlimited,
        status: 'running',
        codes: 0,
        errors: 0,
        results: [],
        createdAt: new Date().toISOString()
      };
      const r = await db.collection(COLLECTION).insertOne(doc);
      return res.json({ _id: r.insertedId, ...doc });
    }

    // ---- UPDATE SESSION ----
    if (action === 'update' && req.method === 'POST') {
      const db = await getDb();
      const { id, ...patch } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      delete patch._id;
      await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        { $set: patch }
      );
      return res.json({ ok: true });
    }

    // ---- DELETE SESSION (full history wipe) ----
    if (action === 'delete' && req.method === 'POST') {
      const db = await getDb();
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
      return res.json({ ok: true, deleted: id });
    }

    // ---- SAVE RESULT BATCH ----
    if (action === 'save' && req.method === 'POST') {
      const db = await getDb();
      const { sessionId, entries } = req.body || {};
      if (!sessionId || !Array.isArray(entries) || !entries.length) {
        return res.status(400).json({ error: 'sessionId and entries[] required' });
      }
      let codes = 0, errors = 0;
      for (const e of entries) {
        if (e.status === 'success') codes++; else errors++;
      }
      await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(sessionId) },
        { $push: { results: { $each: entries } }, $inc: { codes, errors } }
      );
      return res.json({ ok: true, saved: entries.length });
    }

    // ========================================================
    // DEFAULT ACTION: PAIRING REQUEST (POST /api/pair)
    // ========================================================
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

    const { server, number, session } = req.body || {};
    if (!server || !number) return res.status(400).json({ error: 'server and number are required' });

    const base = String(server).trim().replace(/\/+$/, '');
    const clean = String(number).replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(clean)) return res.status(400).json({ error: 'invalid number format' });

    // 🔒 Path is FIXED to /code — the real endpoint of these bots
    const url = `${base}/code?number=${encodeURIComponent(clean)}`;

    const started = Date.now();
    let status = 'unknown', message = '', code = null;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let resp;
      try {
        resp = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const text = (await resp.text()).slice(0, 500);
      status = resp.ok ? 'success' : 'http_' + resp.status;
      message = text;
      try {
        const j = JSON.parse(text);
        code = j.code || j.pairingCode || j.pair_code || j.pairing_code || j.pairCode || null;
      } catch (_) {}
    } catch (e) {
      status = 'error';
      message = e.name === 'AbortError' ? 'timeout (>15s)' : e.message;
    }

    return res.status(200).json({
      server: base, number: clean, status, code,
      ms: Date.now() - started, raw: message
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports.config = { maxDuration: 60 };
