// api/mongo.js — MongoDB connection + all database logic.
// Connection string is hard-coded here (no .env needed).

const { MongoClient, ObjectId } = require('mongodb');

// ✅ YOUR MongoDB URI (already inserted)
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

// ---- CREATE a new session ----
async function createSession(data) {
  const db = await getDb();
  const doc = {
    servers: Array.isArray(data.servers) ? data.servers : [],
    numbers: Array.isArray(data.numbers) ? data.numbers : [],
    path: data.path || '/pair',
    session: data.session || 'default',
    concurrency: data.concurrency || 1,
    delay: data.delay || 0,
    unlimited: !!data.unlimited,
    status: 'running',
    codes: 0,
    errors: 0,
    results: [],
    createdAt: new Date().toISOString()
  };
  const r = await db.collection(COLLECTION).insertOne(doc);
  return { _id: r.insertedId, ...doc };
}

// ---- LIST all sessions (newest first, without the big results array) ----
async function listSessions() {
  const db = await getDb();
  return await db.collection(COLLECTION)
    .find({}, { projection: { results: 0 } })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
}

// ---- UPDATE a session (edit path/session, mark stopped) ----
async function updateSession(id, patch) {
  if (!id) throw new Error('id required');
  const db = await getDb();
  const clean = { ...patch };
  delete clean.id;
  delete clean._id;
  await db.collection(COLLECTION).updateOne(
    { _id: new ObjectId(id) },
    { $set: clean }
  );
  return { ok: true };
}

// ---- DELETE a session ----
async function deleteSession(id) {
  if (!id) throw new Error('id required');
  const db = await getDb();
  await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
  return { ok: true };
}

// ---- APPEND a batch of result entries to a session ----
async function saveEntries(sessionId, entries) {
  if (!sessionId) throw new Error('sessionId required');
  if (!Array.isArray(entries) || !entries.length) throw new Error('entries[] required');
  const db = await getDb();

  let codes = 0, errors = 0;
  for (const e of entries) {
    if (e.status === 'success') codes++;
    else errors++;
  }

  await db.collection(COLLECTION).updateOne(
    { _id: new ObjectId(sessionId) },
    {
      $push: { results: { $each: entries } },
      $inc: { codes, errors }
    }
  );
  return { ok: true, saved: entries.length };
}

// ---- Health check ----
async function health() {
  await getDb();
  return { ok: true };
}

module.exports = {
  getDb,
  createSession,
  listSessions,
  updateSession,
  deleteSession,
  saveEntries,
  health
};
