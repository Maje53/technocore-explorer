CREATE TABLE messages_v2 (
  seq INTEGER NOT NULL,
  room TEXT NOT NULL,
  did TEXT NOT NULL,
  text TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sig TEXT NOT NULL,
  technocore_ts TEXT,
  archived_at TEXT NOT NULL,
  PRIMARY KEY (room, seq)
);
--> statement-breakpoint
INSERT OR IGNORE INTO messages_v2
  (seq, room, did, text, nonce, sig, technocore_ts, archived_at)
SELECT seq, room, did, text, nonce, sig, technocore_ts, archived_at
FROM messages;
--> statement-breakpoint
DROP TABLE messages;
--> statement-breakpoint
ALTER TABLE messages_v2 RENAME TO messages;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_did_seq
ON messages(did, seq DESC);
