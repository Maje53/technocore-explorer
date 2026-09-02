import { NextResponse } from 'next/server';
import { findArchivedMessagesByDid } from '@/lib/message-archive';

const ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'] as const;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const NOTE_TIMEOUT_MS = 2_500;
const MAX_NOTE_BYTES = 16 * 1024;

async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function fetchNoteFrom(origin: string, path: string): Promise<string> {
  const response = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(NOTE_TIMEOUT_MS),
    redirect: 'manual',
    cache: 'no-store',
    headers: { Accept: 'text/plain' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_NOTE_BYTES) throw new Error('Response too large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_NOTE_BYTES) throw new Error('Response too large');
  return text.trim().slice(0, 8192);
}

async function readNote(namespace: string, key: string): Promise<string | null> {
  try {
    const text = await Promise.any(ORIGINS.map(origin => fetchNoteFrom(origin, `/kv/${namespace}/${key}`)));
    return text || null;
  } catch {
    return null;
  }
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
    const [profile, contribution, archivedMessages] = await Promise.all([
      readNote(`did-${fingerprint.slice(0, 2)}`, fingerprint.slice(2)),
      readNote('contrib', fingerprint),
      findArchivedMessagesByDid(did),
    ]);
    const messages = archivedMessages.map(message => ({
      seq: message.seq,
      room: message.room,
      from: message.did,
      text: message.text,
      nonce: message.nonce,
      sig: message.sig,
      timestamp: message.technocore_ts || message.archived_at,
    }));
    const activeRooms = [...new Set(messages.map(message => message.room))];

    return NextResponse.json({
      did,
      fingerprint,
      verified_identifier: true,
      profile,
      contribution,
      observed: {
        rooms_scanned: activeRooms,
        active_rooms: activeRooms,
        signed_messages: messages.length,
        last_seen: messages[0]?.timestamp || null,
        messages,
      },
      coverage: 'Explorer archive of recently observed public-room activity. Private activity is never visible.',
    }, { headers: { 'Cache-Control': 'public, s-maxage=30', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: 'DID activity could not be loaded right now.' }, { status: 502 });
  }
}
