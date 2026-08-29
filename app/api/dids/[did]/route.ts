import { NextResponse } from 'next/server';
import { findArchivedMessagesByDid } from '@/lib/message-archive';

const ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'] as const;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DIRECTORY_ROOM_LIMIT = 8;
const ROOM_MESSAGE_LIMIT = 100;

type PublicMessage = {
  seq: number;
  from: string;
  text: string;
  nonce: string | number;
  sig?: string;
  ts?: string;
  timestamp?: string;
};

type ObservedMessage = PublicMessage & { room: string };

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Response too large');
  }
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Response too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

async function fetchPublic(path: string, accept = 'application/json'): Promise<Response | null> {
  for (const origin of ORIGINS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(new URL(path, origin), {
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
        headers: { Accept: accept },
      });
      if (response.ok) return response;
      if (response.status === 404) return null;
    } catch {
      // Try the canonical fallback origin.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function isPublicMessage(value: unknown): value is PublicMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(message.seq) &&
    typeof message.from === 'string' &&
    typeof message.text === 'string' &&
    message.text.length <= 4096 &&
    (typeof message.nonce === 'string' || Number.isSafeInteger(message.nonce)) &&
    (message.sig === undefined || typeof message.sig === 'string') &&
    (message.ts === undefined || typeof message.ts === 'string') &&
    (message.timestamp === undefined || typeof message.timestamp === 'string')
  );
}

async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function readNote(namespace: string, key: string): Promise<string | null> {
  const response = await fetchPublic(`/kv/${namespace}/${key}`, 'text/plain');
  if (!response) return null;
  const text = (await readBoundedText(response)).trim();
  return text ? text.slice(0, 8192) : null;
}

async function discoverRooms(): Promise<string[]> {
  const response = await fetchPublic(`/rooms?format=json&limit=${DIRECTORY_ROOM_LIMIT}&n=${Date.now()}`);
  const rooms = new Set<string>(['lobby', 'technocore']);
  if (!response) return [...rooms];
  const payload = JSON.parse(await readBoundedText(response)) as Record<string, unknown>;
  if (Array.isArray(payload.rooms)) {
    for (const item of payload.rooms) {
      const name = item && typeof item === 'object' ? (item as Record<string, unknown>).room : null;
      if (typeof name === 'string' && ROOM_PATTERN.test(name) && !name.startsWith('p-')) rooms.add(name);
    }
  }
  return [...rooms].slice(0, DIRECTORY_ROOM_LIMIT + 2);
}

async function findMessages(room: string, did: string): Promise<ObservedMessage[]> {
  const response = await fetchPublic(`/r/${room}?format=json&limit=${ROOM_MESSAGE_LIMIT}&n=${Date.now()}`);
  if (!response) return [];
  const payload = JSON.parse(await readBoundedText(response)) as Record<string, unknown>;
  if (!Array.isArray(payload.messages)) return [];
  return payload.messages
    .filter(isPublicMessage)
    .filter(message => message.from === did)
    .map(message => ({ ...message, room }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ did: string }> },
) {
  const { did: encodedDid } = await params;
  const did = decodeURIComponent(encodedDid).trim();
  if (!DID_PATTERN.test(did)) {
    return NextResponse.json({ error: 'Enter a valid Ed25519 did:key identifier.' }, { status: 400 });
  }

  try {
    const fingerprint = await sha256Prefix(did);
    const rooms = await discoverRooms();
    const [profile, contribution, archivedMessages, ...roomMatches] = await Promise.all([
      readNote(`did-${fingerprint.slice(0, 2)}`, fingerprint.slice(2)),
      readNote('contrib', fingerprint),
      findArchivedMessagesByDid(did),
      ...rooms.map(room => findMessages(room, did)),
    ]);
    const archived = archivedMessages.map(message => ({
      seq: message.seq,
      room: message.room,
      from: message.did,
      text: message.text,
      nonce: message.nonce,
      sig: message.sig,
      timestamp: message.technocore_ts || message.archived_at,
    }));
    const messages = [...archived, ...roomMatches.flat()]
      .filter((message, index, all) => all.findIndex(candidate => candidate.seq === message.seq && candidate.room === message.room) === index)
      .sort((a, b) => (b.timestamp || b.ts || '').localeCompare(a.timestamp || a.ts || '') || b.seq - a.seq)
      .slice(0, 100);
    const activeRooms = [...new Set(messages.map(message => message.room))];

    return NextResponse.json(
      {
        did,
        fingerprint,
        verified_identifier: true,
        profile,
        contribution,
        observed: {
          rooms_scanned: rooms,
          active_rooms: activeRooms,
          signed_messages: messages.length,
          last_seen: messages[0]?.timestamp || messages[0]?.ts || null,
          messages,
        },
        coverage: `Explorer archive plus the newest ${ROOM_MESSAGE_LIMIT} messages from ${rooms.length} public rooms. Private activity is not visible.`,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch {
    return NextResponse.json({ error: 'DID activity could not be loaded right now.' }, { status: 502 });
  }
}
