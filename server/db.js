// server/db.js
//
// Persistent storage for the AI Assistant room, using SQLite via
// better-sqlite3 (synchronous, embedded, zero external services — fits
// this project's "no external database" spirit while still surviving
// server restarts, which the AI room specifically needs for memory).
//
// This is the ONLY part of the app that persists to disk. Regular chat
// rooms remain fully in-memory/ephemeral, unchanged.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'ai-assistant.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_profiles (
    username TEXT PRIMARY KEY,
    preferred_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_username_id
    ON conversations (username, id);
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmtGetProfile = db.prepare('SELECT * FROM ai_profiles WHERE username = ?');

const stmtUpsertProfile = db.prepare(`
  INSERT INTO ai_profiles (username, preferred_name, created_at, updated_at)
  VALUES (@username, @preferredName, @now, @now)
  ON CONFLICT(username) DO UPDATE SET
    preferred_name = excluded.preferred_name,
    updated_at = excluded.updated_at
`);

const stmtInsertMessage = db.prepare(`
  INSERT INTO conversations (username, role, content, timestamp)
  VALUES (@username, @role, @content, @timestamp)
`);

const stmtRecentMessages = db.prepare(`
  SELECT role, content, timestamp FROM (
    SELECT id, role, content, timestamp FROM conversations
    WHERE username = ?
    ORDER BY id DESC
    LIMIT ?
  ) ORDER BY id ASC
`);

const stmtCountMessages = db.prepare(
  'SELECT COUNT(*) AS count FROM conversations WHERE username = ?'
);

const stmtDeleteUserData = db.prepare('DELETE FROM conversations WHERE username = ?');
const stmtDeleteProfile = db.prepare('DELETE FROM ai_profiles WHERE username = ?');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns { username, preferred_name, created_at, updated_at } or undefined.
 */
function getProfile(username) {
  return stmtGetProfile.get(username);
}

/**
 * Creates or updates the user's chosen display name for the AI to use.
 */
function setPreferredName(username, preferredName) {
  stmtUpsertProfile.run({ username, preferredName, now: Date.now() });
}

/**
 * Appends one message (user or assistant turn) to a user's private AI
 * conversation history.
 */
function addMessage(username, role, content, timestamp) {
  stmtInsertMessage.run({ username, role, content, timestamp: timestamp || Date.now() });
}

/**
 * Returns up to `limit` most recent messages for a user, oldest first —
 * ready to feed straight into the OpenAI chat completion `messages` array
 * or to render as chat history when the user (re)opens the AI room.
 */
function getRecentMessages(username, limit = 30) {
  return stmtRecentMessages.all(username, limit);
}

function hasAnyHistory(username) {
  const row = stmtCountMessages.get(username);
  return !!row && row.count > 0;
}

/**
 * Wipes a user's AI memory entirely (profile + conversation history).
 * Not exposed over the socket API by default, but available for future
 * "reset my AI memory" functionality or admin/maintenance scripts.
 */
function resetUser(username) {
  stmtDeleteUserData.run(username);
  stmtDeleteProfile.run(username);
}

module.exports = {
  getProfile,
  setPreferredName,
  addMessage,
  getRecentMessages,
  hasAnyHistory,
  resetUser,
};
