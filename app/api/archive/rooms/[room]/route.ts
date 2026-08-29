import { NextResponse } from 'next/server';
import { archiveMessages, claimRoomSync, completeRoomSync } from '@/lib/message-archive';

const ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'] as const;
const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

type PublicMessage = { seq: number; from: string; text: string; nonce: string | number; sig?: string; ts?: string; timestamp?: string };

function validMessage(value: unknown): value is PublicMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return Number.isSafeInteger(message.seq) && (message.seq as number) > 0 && typeof message.from === 'string' && DID_PATTERN.test(message.from) && typeof message.text === 'string' && message.text.length <= 4096 && (typeof message.nonce === 'string' || Number.isSafeInteger(message.nonce)) && (message.sig === undefined || typeof message.sig === 'string');
}

async function fetchRoom(room: string) {
  for (const origin of [ORIGINS[0], ORIGINS[0], ORIGINS[1]]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const url = new URL(`/r/${room}`, origin);
      url.search = new URLSearchParams({ format: 'json', limit: '200', n: String(Date.now()) }).toString();
      const response = await fetch(url, { signal: controller.signal, redirect: 'manual', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > 2 * 1024 * 1024) continue;
      const payload = await response.json() as { messages?: unknown[] };
      return Array.isArray(payload.messages) ? payload.messages.filter(validMessage) : [];
    } catch { /* Try the next fixed origin. */ }
    finally { clearTimeout(timeout); }
  }
  return null;
}

export async function POST(_request: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  if (!ROOM_PATTERN.test(room) || room.startsWith('p-')) return NextResponse.json({ error: 'Only public rooms are supported.' }, { status: 400 });
  if (!await claimRoomSync(room)) return NextResponse.json({ status: 'in_progress', room }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const messages = await fetchRoom(room);
    if (!messages) return NextResponse.json({ status: 'upstream_unavailable', room }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    const archived = await archiveMessages(messages.map(message => ({ seq: message.seq, room, did: message.from, text: message.text, nonce: String(message.nonce), sig: message.sig || '', technocore_ts: message.timestamp || message.ts || null })));
    return NextResponse.json({ status: 'synced', room, seen: messages.length, archived }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } finally {
    await completeRoomSync(room);
  }
}
