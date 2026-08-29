import { env } from 'cloudflare:workers';
import { createMessagesDidIndex, createMessagesTable, createRoomSyncStateTable, createSyncStateTable } from '@/db/schema';

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
    db.prepare(createSyncStateTable),
    db.prepare(createRoomSyncStateTable),
  ]);
  return db;
}

export async function archiveMessages(messages: Array<Omit<ArchivedMessage, 'archived_at'>>) {
  if (!messages.length) return 0;
  const db = await ensureSchema();
  let archived = 0;
  for (let offset = 0; offset < messages.length; offset += 50) {
    const chunk = messages.slice(offset, offset + 50);
    const results = await db.batch(chunk.map(message => db.prepare(`
      INSERT OR IGNORE INTO messages
        (seq, room, did, text, nonce, sig, technocore_ts, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(message.seq, message.room, message.did, message.text, message.nonce, message.sig, message.technocore_ts, new Date().toISOString())));
    archived += results.reduce((total, result) => total + (result.meta.changes || 0), 0);
  }
  return archived;
}

export async function claimArchiveSync(staleLockMs = 60_000) {
  const db = await ensureSchema();
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO sync_state (id, last_started_at) VALUES (1, 0)`).run();
  const result = await db.prepare(`
    UPDATE sync_state SET last_started_at = ?
    WHERE id = 1 AND last_started_at <= ?
  `).bind(now, now - staleLockMs).run();
  return (result.meta.changes || 0) > 0;
}

export async function completeArchiveSync(roomsScanned: number, messagesSeen: number, messagesArchived: number) {
  const db = await ensureSchema();
  await db.prepare(`
    UPDATE sync_state
    SET last_started_at = 0, last_completed_at = ?, rooms_scanned = ?, messages_seen = ?, messages_archived = ?
    WHERE id = 1
  `).bind(new Date().toISOString(), roomsScanned, messagesSeen, messagesArchived).run();
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

export async function findArchivedMessage(seq: number, room: string) {
  const db = await ensureSchema();
  return db.prepare(`
    SELECT seq, room, did, text, nonce, sig, technocore_ts, archived_at
    FROM messages
    WHERE seq = ? AND room = ?
    LIMIT 1
  `).bind(seq, room).first<ArchivedMessage>();
}

export async function claimRoomSync(room: string, staleLockMs = 15_000) {
  const db = await ensureSchema();
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO room_sync_state (room, last_started_at) VALUES (?, 0)`).bind(room).run();
  const result = await db.prepare(`
    UPDATE room_sync_state SET last_started_at = ?
    WHERE room = ? AND last_started_at <= ?
  `).bind(now, room, now - staleLockMs).run();
  return (result.meta.changes || 0) > 0;
}

export async function completeRoomSync(room: string) {
  const db = await ensureSchema();
  await db.prepare(`
    UPDATE room_sync_state SET last_started_at = 0, last_completed_at = ?
    WHERE room = ?
  `).bind(new Date().toISOString(), room).run();
}

export async function findArchivedMessagesByDid(did: string, limit = 100) {
  const db = await ensureSchema();
  const result = await db.prepare(`
    SELECT seq, room, did, text, nonce, sig, technocore_ts, archived_at
    FROM messages
    WHERE did = ?
    ORDER BY seq DESC
    LIMIT ?
  `).bind(did, Math.min(100, Math.max(1, limit))).all<ArchivedMessage>();
  return result.results;
}
