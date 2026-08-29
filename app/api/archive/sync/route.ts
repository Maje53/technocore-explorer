import { NextResponse } from 'next/server';
import { archiveMessages, claimArchiveSync, completeArchiveSync } from '@/lib/message-archive';

const ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'] as const;
const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const MAX_ROOMS = 12;
const MESSAGES_PER_ROOM = 200;

type PublicMessage = { seq: number; from: string; text: string; nonce: string | number; sig?: string; ts?: string; timestamp?: string };

async function fetchJson(path: string) {
  for (const origin of ORIGINS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(new URL(path, origin), { signal: controller.signal, redirect: 'manual', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > 2 * 1024 * 1024) continue;
      return await response.json() as Record<string, unknown>;
    } catch { /* Try the next fixed origin. */ }
    finally { clearTimeout(timeout); }
  }
  return null;
}

function validMessage(value: unknown): value is PublicMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return Number.isSafeInteger(message.seq) && (message.seq as number) > 0 && typeof message.from === 'string' && DID_PATTERN.test(message.from) && typeof message.text === 'string' && message.text.length <= 4096 && (typeof message.nonce === 'string' || Number.isSafeInteger(message.nonce)) && (message.sig === undefined || typeof message.sig === 'string');
}

export async function POST() {
  if (!await claimArchiveSync()) return NextResponse.json({ status: 'recently_synced' }, { headers: { 'Cache-Control': 'no-store' } });
  const directory = await fetchJson(`/rooms?format=json&limit=${MAX_ROOMS}&n=${Date.now()}`);
  const rooms = new Set<string>(['lobby', 'technocore']);
  if (Array.isArray(directory?.rooms)) {
    for (const item of directory.rooms) {
      const room = item && typeof item === 'object' ? (item as Record<string, unknown>).room : null;
      if (typeof room === 'string' && ROOM_PATTERN.test(room) && !room.startsWith('p-')) rooms.add(room);
      if (rooms.size >= MAX_ROOMS) break;
    }
  }

  const roomNames = [...rooms];
  const results = await Promise.all(roomNames.map(async room => {
    const payload = await fetchJson(`/r/${room}?format=json&limit=${MESSAGES_PER_ROOM}&n=${Date.now()}`);
    const messages = Array.isArray(payload?.messages) ? payload.messages.filter(validMessage) : [];
    return messages.map(message => ({ seq: message.seq, room, did: message.from, text: message.text, nonce: String(message.nonce), sig: message.sig || '', technocore_ts: message.timestamp || message.ts || null }));
  }));
  const messages = results.flat().filter((message, index, all) => all.findIndex(candidate => candidate.seq === message.seq) === index);
  const archived = await archiveMessages(messages);
  await completeArchiveSync(roomNames.length, messages.length, archived);
  return NextResponse.json({ status: 'synced', rooms: roomNames.length, seen: messages.length, archived }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
