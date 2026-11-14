import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

// Credential stored encrypted as "botToken|chatId" (chatId like @mychannel or -100123...). The bot must be a channel admin.
function parse(token: string) { const [bot, chat] = token.split('|'); return { bot, chat }; }

function linkFor(chat: string, messageId: number) {
  if (chat.startsWith('@')) return `https://t.me/${chat.slice(1)}/${messageId}`;
  return `https://t.me/c/${chat.replace(/^-100/, '')}/${messageId}`;
}

export const telegramAdapter: PlatformAdapter = {
  id: 'telegram',
  canLookup: false,
  rules: { maxChars: 4096, maxImages: 1, mime: ['image/jpeg', 'image/png'], maxImageBytes: 10_000_000 },

  validate(input: PublishInput) {
    // photo captions are shorter than plain messages
    return commonValidate({ ...this.rules, maxChars: input.media.length ? 1024 : 4096 }, 'Telegram', input);
  },

  async publish(input, token) {
    const { bot, chat } = parse(token);
    const photo = input.media[0];
    const method = photo ? 'sendPhoto' : 'sendMessage';
    const body = photo ? { chat_id: chat, photo: photo.url, caption: input.text } : { chat_id: chat, text: input.text };
    const r = await fetch(`https://api.telegram.org/bot${bot}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new PlatformHttpError(j.error_code ?? r.status, j.description ?? 'telegram error', j.parameters?.retry_after);
    return { externalId: String(j.result.message_id), url: linkFor(chat, j.result.message_id) };
  },

  // KNOWN GAP: Telegram's Bot API cannot look up a sent message, so reconcile is impossible.
  // A timeout after Telegram accepted the message may cause one duplicate. Documented in docs/PLATFORMS.md.
  async findExisting() { return null; },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      if (error.status === 429) return { class: 'RETRYABLE', reason: 'Telegram rate limit hit.', retryAfterSeconds: error.retryAfter };
      if (error.status === 401) return { class: 'AUTH', reason: 'Telegram rejected the bot token. Reconnect.' };
      if (error.status === 403) return { class: 'BLOCKED', reason: 'The bot is not allowed to post in this channel. Make it an admin.' };
      if (error.status === 400) return { class: 'VALIDATION', reason: error.message.slice(0, 200) };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'Telegram had a server error.', ambiguous: true };
    }
    return { class: 'RETRYABLE', reason: 'Telegram did not respond in time.', ambiguous: true };
  },
};
