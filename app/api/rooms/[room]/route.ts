import { NextRequest, NextResponse } from 'next/server';

const TECHNOCORE_ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'] as const;
const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

type PublicMessage = {
  seq: number;
  from: string;
  text: string;
  nonce: string | number;
  sig?: string;
  ts?: string;
  timestamp?: string;
};

function validMessage(value: unknown): value is PublicMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(message.seq) &&
    (message.seq as number) > 0 &&
    typeof message.from === 'string' &&
    message.from.startsWith('did:key:z6Mk') &&
    message.from.length <= 64 &&
    typeof message.text === 'string' &&
    message.text.length <= 4096 &&
    (typeof message.nonce === 'string' || Number.isSafeInteger(message.nonce)) &&
    (message.sig === undefined || typeof message.sig === 'string') &&
    (message.ts === undefined || typeof message.ts === 'string') &&
    (message.timestamp === undefined || typeof message.timestamp === 'string')
  );
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
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
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

async function fetchRoom(room: string, limit: number): Promise<Response> {
  let lastError = 'No upstream response';

  for (const origin of TECHNOCORE_ORIGINS) {
    const url = new URL(`/r/${room}`, origin);
    url.search = new URLSearchParams({
      format: 'json',
      limit: String(limit),
      n: String(Date.now()),
    }).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return response;
      lastError = `${origin} returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown fetch error';
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error('Technocore room fetch failed:', lastError);
  throw new Error('All Technocore origins failed');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ room: string }> },
) {
  const { room } = await params;
  if (!ROOM_PATTERN.test(room)) {
    return NextResponse.json({ error: 'Invalid room name.' }, { status: 400 });
  }
  const requested = Number(request.nextUrl.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requested) ? Math.min(200, Math.max(1, requested)) : 50;
  try {
    const response = await fetchRoom(room, limit);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) throw new Error('Unexpected content type');
    const raw = await readBoundedBody(response);
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || body.room !== room || !Array.isArray(body.messages)) throw new Error('Unexpected response');
    const messages = body.messages.filter(validMessage).slice(0, limit).map(({ seq, from, text, nonce, sig, ts, timestamp }) => ({ seq, from, text, nonce, ...(sig ? { sig } : {}), ...(ts ? { ts } : {}), ...(timestamp ? { timestamp } : {}) }));
    const lastSeq = Number.isSafeInteger(body.last_seq) && (body.last_seq as number) >= 0 ? body.last_seq : 0;
    return NextResponse.json({ room, count: messages.length, last_seq: lastSeq, messages }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: 'Technocore is temporarily unreachable.' }, { status: 502 });
  }
}
