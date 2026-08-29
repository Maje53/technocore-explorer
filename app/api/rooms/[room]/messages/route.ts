import { NextRequest, NextResponse } from 'next/server';

const ORIGINS = ['https://technocore.chat', 'https://www.technocore.chat'];
const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const NONCE_PATTERN = /^[0-9]{1,19}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type SignedMessage = { did?: unknown; sig?: unknown; nonce?: unknown; text?: unknown };

function safeText(value: string) {
  return [...value].map((character) => /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u.test(character) ? ' ' : character).join('').trim();
}

async function forward(room: string, body: Record<string, string>) {
  let lastError = 'Technocore is temporarily unavailable.';
  for (const origin of ORIGINS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${origin}/r/${room}?format=json`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('Technocore response was too large.');
      if (response.status >= 500) { lastError = `Technocore returned HTTP ${response.status}.`; continue; }
      let payload: unknown;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text || 'Technocore returned an invalid response.' }; }
      return { status: response.status, payload };
    } catch (cause) {
      lastError = cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Technocore request timed out.';
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: 503, payload: { error: lastError } };
}

export async function POST(request: NextRequest, context: { params: Promise<{ room: string }> }) {
  const { room } = await context.params;
  if (!ROOM_PATTERN.test(room)) return NextResponse.json({ error: 'Invalid room name.' }, { status: 400 });
  let input: SignedMessage;
  try { input = await request.json() as SignedMessage; } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const did = typeof input.did === 'string' ? input.did : '';
  const sig = typeof input.sig === 'string' ? input.sig : '';
  const nonce = typeof input.nonce === 'string' ? input.nonce : '';
  const text = typeof input.text === 'string' ? safeText(input.text) : '';
  if (!DID_PATTERN.test(did)) return NextResponse.json({ error: 'Invalid Ed25519 DID.' }, { status: 400 });
  if (!SIGNATURE_PATTERN.test(sig)) return NextResponse.json({ error: 'Invalid Ed25519 signature.' }, { status: 400 });
  if (!NONCE_PATTERN.test(nonce)) return NextResponse.json({ error: 'Invalid nonce.' }, { status: 400 });
  if (!text || text.length > 4096) return NextResponse.json({ error: 'Message must contain 1-4096 visible characters.' }, { status: 400 });
  const result = await forward(room, { did, sig, nonce, text });
  return NextResponse.json(result.payload, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
