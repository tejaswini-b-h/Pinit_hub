import { PlatformAdapter } from './types';
import { mockAdapter } from './mock';
import { blueskyAdapter } from './bluesky';
import { telegramAdapter } from './telegram';
import { linkedinAdapter } from './linkedin';
import { facebookPageAdapter } from './facebookPage';
import { instagramAdapter } from './instagram';
import { youtubeAdapter } from './youtube';

// To add a platform (X, Instagram, Threads ...): implement PlatformAdapter and register it here. Nothing else changes.
const adapters: Record<string, PlatformAdapter> = {
  mock: mockAdapter, bluesky: blueskyAdapter, telegram: telegramAdapter,
  linkedin: linkedinAdapter, facebook_page: facebookPageAdapter, instagram: instagramAdapter,
  youtube: youtubeAdapter,
};

export const allAdapters = () => Object.values(adapters);

export function getAdapter(platform: string): PlatformAdapter {
  const a = adapters[platform];
  if (!a) throw new Error(`No adapter registered for platform "${platform}"`);
  return a;
}
