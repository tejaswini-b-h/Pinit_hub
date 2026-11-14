import dotenv from 'dotenv';
import { prisma } from '../db';
import { encrypt, decrypt } from './crypto';
import { randomState, makeVerifier, challengeFor } from './pkce';

const GRAPH = () => process.env.GRAPH_VERSION ?? 'v26.0';
const cleanVal = (v: string | undefined) => (v ?? '').trim().replace(/^["']+|["']+$/g, '');
const getEnv = (key: string) => {
  let v = process.env[key];
  if (!v || !v.trim()) {
    try {
      dotenv.config({ override: true });
      v = process.env[key];
    } catch { /* ignore */ }
  }
  return cleanVal(v);
};

export const PLATFORM_PARAMS: Record<string, 'linkedin' | 'facebook_page' | 'instagram' | 'youtube'> = {
  linkedin: 'linkedin',
  facebook: 'facebook_page',
  instagram: 'instagram',
  youtube: 'youtube',
};

interface Provider { authUrl: string; tokenUrl: string; scope: string; clientId: () => string; secret: () => string; pkce: boolean }
const providers: Record<string, Provider> = {
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scope: 'openid profile w_member_social', clientId: () => getEnv('LINKEDIN_CLIENT_ID'), secret: () => getEnv('LINKEDIN_CLIENT_SECRET'),
    pkce: false, // LinkedIn web apps use the client secret; state is still checked
  },
  facebook_page: {
    authUrl: `https://www.facebook.com/${GRAPH()}/dialog/oauth`, tokenUrl: `https://graph.facebook.com/${GRAPH()}/oauth/access_token`,
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish', clientId: () => getEnv('META_APP_ID'), secret: () => getEnv('META_APP_SECRET'),
    pkce: false,
  },
  instagram: {
    authUrl: `https://www.facebook.com/${GRAPH()}/dialog/oauth`, tokenUrl: `https://graph.facebook.com/${GRAPH()}/oauth/access_token`,
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish', clientId: () => getEnv('META_APP_ID'), secret: () => getEnv('META_APP_SECRET'),
    pkce: false,
  },
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube',
    clientId: () => getEnv('YOUTUBE_CLIENT_ID') || getEnv('GOOGLE_CLIENT_ID'), secret: () => getEnv('YOUTUBE_CLIENT_SECRET') || getEnv('GOOGLE_CLIENT_SECRET'),
    pkce: false,
  },
};
const redirectUri = (param: string) => `${process.env.API_URL}/v1/publish/accounts/${param}/callback`;

export async function startOAuth(ownerId: string, param: string): Promise<string> {
  const platform = PLATFORM_PARAMS[param]; const p = providers[platform];
  if (!p) throw new Error('Unknown platform');
  const clientId = p.clientId().trim().replace(/^["']+|["']+$/g, '');
  if (!clientId) {
    const varName = (platform === 'facebook_page' || platform === 'instagram')
      ? 'META_APP_ID'
      : (platform === 'youtube' ? 'YOUTUBE_CLIENT_ID' : 'LINKEDIN_CLIENT_ID');
    throw new Error(`${varName} is missing or empty in apps/api/.env. Please set it and restart the API server.`);
  }
  const state = randomState(); const verifier = makeVerifier();
  await prisma.oAuthState.create({ data: { state, ownerId, platform, codeVerifier: verifier, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  const u = new URL(p.authUrl);
  u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri(param)); u.searchParams.set('state', state);

  if (platform === 'facebook_page' || platform === 'instagram') {
    u.searchParams.set('auth_type', 'rerequest');
    if (process.env.META_LOGIN_CONFIG_ID?.trim()) {
      const configId = process.env.META_LOGIN_CONFIG_ID.trim().replace(/^["']+|["']+$/g, '');
      u.searchParams.set('config_id', configId);
      u.searchParams.set('override_default_response_type', 'true');
    } else {
      u.searchParams.set('scope', p.scope);
    }
  } else if (platform === 'youtube') {
    u.searchParams.set('scope', p.scope);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
  } else {
    u.searchParams.set('scope', p.scope);
  }

  if (p.pkce) { u.searchParams.set('code_challenge', challengeFor(verifier)); u.searchParams.set('code_challenge_method', 'S256'); }
  return u.toString();
}

async function tokenRequest(url: string, params: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`); // never include the response: it may hold secrets
  return (await r.json()) as any;
}

async function saveAccount(ownerId: string, platform: string, externalId: string, displayName: string,
  access: string, refresh: string | null, expiresAt: Date | null) {
  const data = { displayName, accessTokenEnc: encrypt(access), refreshTokenEnc: refresh ? encrypt(refresh) : null, expiresAt, status: 'CONNECTED' };
  await prisma.socialAccount.upsert({
    where: { ownerId_platform_externalId: { ownerId, platform, externalId } },
    create: { ownerId, platform, externalId, ...data }, update: data,
  });
  await prisma.auditLog.create({ data: { ownerId, action: 'connect', detail: `${platform} ${displayName}` } });
}

/** Returns the owner id the state belonged to. State is single use and expires after 10 minutes. */
export async function finishOAuth(param: string, code: string, state: string): Promise<string> {
  const platform = PLATFORM_PARAMS[param]; const p = providers[platform];
  if (!p) throw new Error('Unknown platform');
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  const gone = await prisma.oAuthState.deleteMany({ where: { state } }); // atomic: a replayed callback finds nothing to delete
  if (!row || gone.count !== 1 || row.platform !== platform || row.expiresAt < new Date()) throw new Error('Invalid or expired login attempt');

  const t = await tokenRequest(p.tokenUrl, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(param), client_id: p.clientId(), client_secret: p.secret(),
    ...(p.pkce ? { code_verifier: row.codeVerifier } : {}),
  });

  if (platform === 'linkedin') {
    const me = await (await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json() as any;
    if (!me.sub) throw new Error('Could not read the LinkedIn profile');
    await saveAccount(row.ownerId, platform, me.sub, me.name ?? 'LinkedIn member', t.access_token, t.refresh_token ?? null,
      new Date(Date.now() + (t.expires_in ?? 5184000) * 1000));
  } else if (platform === 'youtube') {
    const chResp = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${t.access_token}` },
    });
    const chData = await chResp.json() as any;
    if (chData.error) {
      console.error(JSON.stringify({ msg: 'YouTube channels error', error: chData.error }));
      throw new Error(`YouTube error: ${chData.error.message ?? 'Failed to fetch YouTube channel'}`);
    }
    if (!chData.items || chData.items.length === 0) {
      throw new Error('No YouTube channel found for this Google account. Please create a YouTube channel at https://www.youtube.com first, then reconnect.');
    }
    const channel = chData.items[0];
    const channelId = channel.id;
    const channelTitle = channel.snippet?.title ? `${channel.snippet.title} (YouTube)` : 'YouTube Channel';
    const expiresAt = new Date(Date.now() + (t.expires_in ?? 3600) * 1000);
    const existing = await prisma.socialAccount.findUnique({
      where: { ownerId_platform_externalId: { ownerId: row.ownerId, platform, externalId: channelId } },
    });
    const refreshToken = t.refresh_token ?? (existing?.refreshTokenEnc ? decrypt(existing.refreshTokenEnc) : null);
    await saveAccount(row.ownerId, platform, channelId, channelTitle, t.access_token, refreshToken, expiresAt);
  } else {
    // user token -> long-lived user token -> Page tokens (which do not expire)
    const ll = await tokenRequest(p.tokenUrl, { grant_type: 'fb_exchange_token', client_id: p.clientId(), client_secret: p.secret(), fb_exchange_token: t.access_token });
    const pagesResp = await fetch(`https://graph.facebook.com/${GRAPH()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(ll.access_token)}`);
    const pages = await pagesResp.json() as any;
    if (pages.error) {
      console.error(JSON.stringify({ msg: 'Facebook /me/accounts error', error: pages.error }));
      throw new Error(`Facebook error: ${pages.error.message ?? 'Failed to fetch pages'}`);
    }

    // Fallback: If page is managed through Meta Business Portfolio / Business Manager
    if (!pages.data?.length) {
      try {
        const bizResp = await fetch(`https://graph.facebook.com/${GRAPH()}/me/businesses?fields=id,name,owned_pages{id,name,access_token,instagram_business_account{id,username,name}},client_pages{id,name,access_token,instagram_business_account{id,username,name}}&access_token=${encodeURIComponent(ll.access_token)}`);
        const biz = await bizResp.json() as any;
        if (biz.data?.length) {
          pages.data = [];
          for (const b of biz.data) {
            if (b.owned_pages?.data) pages.data.push(...b.owned_pages.data);
            if (b.client_pages?.data) pages.data.push(...b.client_pages.data);
          }
        }
      } catch (e) {
        console.warn('Fallback /me/businesses lookup failed:', (e as Error).message);
      }
    }

    if (!pages.data?.length) {
      let extraHint = '';
      try {
        const perms = await (await fetch(`https://graph.facebook.com/${GRAPH()}/me/permissions?access_token=${encodeURIComponent(ll.access_token)}`)).json() as any;
        const granted = (perms.data ?? []).filter((x: any) => x.status === 'granted').map((x: any) => x.permission);
        console.warn(JSON.stringify({ msg: 'Granted permissions on token', granted }));
        if (!granted.includes('pages_show_list')) {
          extraHint = ' Permission "pages_show_list" was not granted.';
        }
      } catch { /* ignore */ }
      throw new Error(`No Facebook Pages found for this login.${extraHint} During Facebook login, please click "Edit Settings" or check the box to select your Page.`);
    }

    let saved = 0;
    for (const pg of pages.data) {
      // Connect Facebook Page (if user clicked Facebook or general connect)
      if (platform !== 'instagram') {
        await saveAccount(row.ownerId, 'facebook_page', pg.id, pg.name, pg.access_token, null, null);
        saved++;
      }
      // Connect linked Instagram Business account if present
      if (pg.instagram_business_account?.id) {
        const ig = pg.instagram_business_account;
        const displayName = ig.username ? `@${ig.username}` : (ig.name ?? 'Instagram account');
        await saveAccount(row.ownerId, 'instagram', ig.id, displayName, pg.access_token, null, null);
        saved++;
      }
    }

    if (platform === 'instagram' && saved === 0) {
      throw new Error('No Instagram Professional/Business account was found linked to your Facebook Page. Please ensure your Instagram is a Professional/Business account and linked in your Facebook Page Settings.');
    }
  }
  return row.ownerId;
}
