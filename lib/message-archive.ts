import { env } from 'cloudflare:workers';
import { createMessagesDidIndex, createMessagesTable } from '@/db/schema';

export type ArchivedMessage = {
  seq: number;
  room: string;
  did: string;
  text: string;
  nonce: string;
  sig: string;
  technocore_ts: string | null;
  archived_at: string;
};

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

async function ensureSchema() {
  const db = database();
  await db.batch([
    db.prepare(createMessagesTable),
    db.prepare(createMessagesDidIndex),
  ]);
  return db;
}

export async function archiveMessage(message: Omit<ArchivedMessage, 'archived_at'>) {
  const db = await ensureSchema();
  await db.prepare(`
    INSERT OR IGNORE INTO messages
      (seq, room, did, text, nonce, sig, technocore_ts, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    message.seq,
    message.room,
    message.did,
    message.text,
    message.nonce,
    message.sig,
    message.technocore_ts,
    new Date().toISOString(),
  ).run();
}

export async function findArchivedMessage(seq: number) {
  const db = await ensureSchema();
  return db.prepare(`
    SELECT seq, room, did, text, nonce, sig, technocore_ts, archived_at
    FROM messages
    WHERE seq = ?
    LIMIT 1
  `).bind(seq).first<ArchivedMessage>();
}
