// Platforms that connect with a credential instead of OAuth (Bluesky app password, Telegram bot).
export interface Verified { externalId: string; displayName: string; token: string }

export async function verifyCredentials(platform: string, a: string, b: string): Promise<Verified> {
  if (platform === 'bluesky') {
    const r = await fetch(`${process.env.BLUESKY_PDS ?? 'https://bsky.social'}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: a, password: b }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('Bluesky did not accept that handle and app password.');
    const j: any = await r.json();
    return { externalId: j.did, displayName: j.handle, token: `${a}|${b}` };
  }
  if (platform === 'telegram') { // a = bot token, b = channel (@name or numeric id)
    const me: any = await (await fetch(`https://api.telegram.org/bot${a}/getMe`, { signal: AbortSignal.timeout(10000) })).json();
    if (!me.ok) throw new Error('Telegram did not accept that bot token.');
    const chat: any = await (await fetch(`https://api.telegram.org/bot${a}/getChat?chat_id=${encodeURIComponent(b)}`, { signal: AbortSignal.timeout(10000) })).json();
    if (!chat.ok) throw new Error('The bot cannot see that channel. Add it as an admin first.');
    return { externalId: String(chat.result.id), displayName: chat.result.title ?? b, token: `${a}|${b}` };
  }
  throw new Error('This platform does not use credentials.');
}
