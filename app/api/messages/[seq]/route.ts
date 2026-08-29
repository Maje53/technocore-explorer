import { NextResponse } from 'next/server';
import { archiveMessage, findArchivedMessage } from '@/lib/message-archive';

const ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'] as const;

type UpstreamMessage = {
  seq: number;
  from: string;
  text: string;
  nonce: string | number;
  sig?: string;
  ts?: string;
  timestamp?: string;
};

function isMessage(value: unknown, seq: number): value is UpstreamMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.seq === seq && typeof item.from === 'string' && typeof item.text === 'string' && (typeof item.nonce === 'string' || Number.isSafeInteger(item.nonce));
}

async function findRecent(seq: number, room: string) {
  for (const origin of ORIGINS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const url = new URL(`/r/${room}`, origin);
      url.search = new URLSearchParams({ format: 'json', since: String(seq - 1), limit: '200', n: String(Date.now()) }).toString();
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'manual', signal: controller.signal });
      if (!response.ok) continue;
      const body = await response.json() as { messages?: unknown[] };
      const message = body.messages?.find((item) => isMessage(item, seq));
      if (message) return message;
    } catch { /* Try the next fixed origin. */ }
    finally { clearTimeout(timeout); }
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ seq: string }> }) {
  const { seq: rawSeq } = await params;
  const seq = Number(rawSeq);
  if (!Number.isSafeInteger(seq) || seq < 1) return NextResponse.json({ error: 'Enter a valid sequence number.' }, { status: 400 });
  const url = new URL(request.url);
  const room = url.searchParams.get('room') || 'lobby';
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room) || room.startsWith('p-')) return NextResponse.json({ error: 'Only public rooms are supported.' }, { status: 400 });

  const archived = await findArchivedMessage(seq, room);
  if (archived) return NextResponse.json({ found: true, source: 'explorer_archive', message: archived }, { headers: { 'Cache-Control': 'no-store' } });

  const recent = await findRecent(seq, room);
  if (recent) {
    if (recent.sig) await archiveMessage({ seq, room, did: recent.from, text: recent.text, nonce: String(recent.nonce), sig: recent.sig, technocore_ts: recent.timestamp || recent.ts || null });
    return NextResponse.json({ found: true, source: 'technocore_live', message: { ...recent, room, did: recent.from } }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ found: false, error: 'This sequence is not in the Explorer archive or Technocore’s current live window.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
