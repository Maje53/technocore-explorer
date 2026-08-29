CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY,
  room TEXT NOT NULL,
  did TEXT NOT NULL,
  text TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sig TEXT NOT NULL,
  technocore_ts TEXT,
  archived_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_did_seq
ON messages(did, seq DESC);
