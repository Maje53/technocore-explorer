export const createMessagesTable = `
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY,
  room TEXT NOT NULL,
  did TEXT NOT NULL,
  text TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sig TEXT NOT NULL,
  technocore_ts TEXT,
  archived_at TEXT NOT NULL
)`;

export const createMessagesDidIndex = `
CREATE INDEX IF NOT EXISTS idx_messages_did_seq
ON messages(did, seq DESC)
`;

export const createSyncStateTable = `
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_started_at INTEGER NOT NULL,
  last_completed_at TEXT,
  rooms_scanned INTEGER NOT NULL DEFAULT 0,
  messages_seen INTEGER NOT NULL DEFAULT 0,
  messages_archived INTEGER NOT NULL DEFAULT 0
)
`;
