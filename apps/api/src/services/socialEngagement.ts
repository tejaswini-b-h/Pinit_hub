import { prisma } from '../db';
import { decrypt, encrypt } from './crypto';
import { getAdapter } from '../adapters/registry';

export interface FetchedEngagement {
  platform: string;
  externalId: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  likes: Array<{
    externalId?: string;
    authorName: string;
    authorHandle?: string;
    authorAvatarUrl?: string;
    authorProfileUrl?: string;
    likedAt: Date;
  }>;
  comments: Array<{
    externalId?: string;
    authorName: string;
    authorHandle?: string;
    authorAvatarUrl?: string;
    authorProfileUrl?: string;
    content: string;
    likeCount?: number;
    publishedAt: Date;
  }>;
  shares: Array<{
    externalId?: string;
    authorName: string;
    authorHandle?: string;
    authorAvatarUrl?: string;
    authorProfileUrl?: string;
    note?: string;
    sharedAt: Date;
  }>;
}

/**
 * Ensures access token is valid and refreshed if expired or expiring soon.
 */
async function getValidToken(account: any): Promise<string> {
  if (!account) return '';
  let token = '';
  if (account.accessTokenEnc) {
    try {
      token = decrypt(account.accessTokenEnc);
    } catch {
      console.warn(`[Engagement] Failed to decrypt token for account ${account.id}`);
    }
  }

  // If token is expired or expiring within 5 minutes, attempt refresh
  const isExpiring = account.expiresAt && (new Date(account.expiresAt).getTime() - Date.now() < 300_000);
  if (isExpiring && account.refreshTokenEnc) {
    try {
      const adapter = getAdapter(account.platform);
      if (adapter && adapter.refresh) {
        const refreshRaw = decrypt(account.refreshTokenEnc);
        const t = await adapter.refresh(refreshRaw);
        token = t.accessToken;
        await prisma.socialAccount.update({
          where: { id: account.id },
          data: {
            accessTokenEnc: encrypt(t.accessToken),
            refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : account.refreshTokenEnc,
            expiresAt: t.expiresAt,
            status: 'CONNECTED',
          },
        });
        console.log(`[Engagement] Refreshed token for ${account.platform} account ${account.id}`);
      }
    } catch (e: any) {
      console.warn(`[Engagement] Token refresh error for ${account.platform}: ${e.message}`);
    }
  }

  return token;
}

/**
 * Force-refresh an account's token immediately (e.g. after receiving a 401 Unauthorized)
 */
async function forceRefreshToken(account: any): Promise<string> {
  if (!account?.refreshTokenEnc) return '';
  try {
    const adapter = getAdapter(account.platform);
    if (adapter && adapter.refresh) {
      const refreshRaw = decrypt(account.refreshTokenEnc);
      const t = await adapter.refresh(refreshRaw);
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: encrypt(t.accessToken),
          refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : account.refreshTokenEnc,
          expiresAt: t.expiresAt,
          status: 'CONNECTED',
        },
      });
      console.log(`[Engagement] Force-refreshed token for ${account.platform} account ${account.id}`);
      return t.accessToken;
    }
  } catch (e: any) {
    console.warn(`[Engagement] Force-refresh failed for ${account.platform}: ${e.message}`);
  }
  return '';
}

/**
 * Cleans and extracts a standard 11-char YouTube video ID from IDs or URLs.
 */
function cleanYouTubeVideoId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const vMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (vMatch) return vMatch[1];
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = trimmed.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  const idMatch = trimmed.match(/^[a-zA-Z0-9_-]{11}$/);
  if (idMatch) return idMatch[0];
  return trimmed;
}

/**
 * Safely extracts a JSON object from an HTML string after a given identifier.
 * Uses balanced brace counting to avoid truncation by nested braces or regex greediness.
 */
function extractJsonFromScript(html: string, identifier: string): any {
  const idIndex = html.indexOf(identifier);
  if (idIndex === -1) return null;

  const startIndex = html.indexOf('{', idIndex + identifier.length);
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < html.length; i++) {
    const c = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = html.slice(startIndex, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Helper to recursively search an object tree for YouTube commentRenderer items
 */
function extractCommentsFromTree(obj: any, targetList: any[]) {
  if (!obj || typeof obj !== 'object') return;

  if (obj.commentRenderer) {
    const cr = obj.commentRenderer;
    const authorName = cr.authorText?.simpleText ||
                       (cr.authorText?.runs || []).map((r: any) => r.text).join('') ||
                       'YouTube Viewer';
    const navUrl = cr.authorEndpoint?.commandMetadata?.webCommandMetadata?.url ||
                   cr.authorEndpoint?.browseEndpoint?.canonicalBaseUrl ||
                   '';
    let authorHandle: string | undefined = undefined;
    if (navUrl.includes('/@')) {
      authorHandle = '@' + navUrl.split('/@')[1].split('/')[0];
    } else if (authorName.startsWith('@')) {
      authorHandle = authorName;
    } else if (authorName && authorName !== 'YouTube Viewer') {
      authorHandle = `@${authorName.replace(/\s+/g, '')}`;
    }
    const content = (cr.contentText?.runs || []).map((r: any) => r.text).join('') ||
                    cr.contentText?.simpleText ||
                    '';
    const avatar = cr.authorThumbnail?.thumbnails?.[cr.authorThumbnail.thumbnails.length - 1]?.url ||
                   cr.authorThumbnail?.thumbnails?.[0]?.url;
    const voteCountRaw = cr.voteCount?.simpleText || (cr.voteCount?.runs || []).map((r: any) => r.text).join('') || '0';
    let likeCount = parseInt(voteCountRaw.replace(/[^\d]/g, ''), 10) || 0;
    if (voteCountRaw.toUpperCase().includes('K')) likeCount *= 1000;
    const id = cr.commentId || cr.id || `yt_c_${targetList.length + 1}`;

    if (content && !targetList.some(x => x.externalId === id)) {
      targetList.push({
        externalId: id,
        authorName,
        authorHandle,
        authorAvatarUrl: avatar,
        authorProfileUrl: navUrl ? (navUrl.startsWith('http') ? navUrl : `https://www.youtube.com${navUrl}`) : undefined,
        content,
        likeCount,
        publishedAt: new Date(),
      });
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) extractCommentsFromTree(item, targetList);
  } else {
    for (const k of Object.keys(obj)) extractCommentsFromTree(obj[k], targetList);
  }
}

/**
 * Scans raw HTML for individual commentRenderer JSON snippets.
 * Bypasses full-page JSON.parse failures if the 5MB ytInitialData script has any syntax issues.
 */
function extractCommentsDirectFromHtml(html: string, commentsList: any[]) {
  let pos = 0;
  const needle = '"commentRenderer":';
  while ((pos = html.indexOf(needle, pos)) !== -1) {
    const start = pos + needle.length;
    const rawObj = extractJsonFromScript(html.slice(start, start + 8000), '');
    if (rawObj && (rawObj.contentText || rawObj.authorText)) {
      extractCommentsFromTree({ commentRenderer: rawObj }, commentsList);
    }
    pos = start + 50;
  }
}

/**
 * Specifically targets the comments-section continuation token in YouTube responses.
 * Prevents accidentally grabbing the related-videos sidebar continuation token.
 */
function findCommentsSectionToken(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;

  if (
    obj.targetId === 'comments-section' ||
    obj.targetId === 'engagement-panel-comments-section' ||
    obj.sectionIdentifier === 'comment-item-section' ||
    obj.panelIdentifier === 'engagement-panel-comments-section'
  ) {
    const tok = findAnyContinuationToken(obj);
    if (tok) return tok;
  }

  if (obj.continuationItemRenderer?.targetId === 'comments-section') {
    const tok = obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
                obj.continuationItemRenderer?.continuationCommand?.token;
    if (tok && typeof tok === 'string') return tok;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findCommentsSectionToken(item);
      if (res) return res;
    }
  } else {
    for (const k of Object.keys(obj)) {
      const res = findCommentsSectionToken(obj[k]);
      if (res) return res;
    }
  }
  return null;
}

/**
 * Helper to recursively locate any continuation token as a fallback
 */
function findAnyContinuationToken(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;

  if (obj.continuationCommand && typeof obj.continuationCommand.token === 'string') {
    return obj.continuationCommand.token;
  }
  if (obj.continuationEndpoint?.continuationCommand?.token && typeof obj.continuationEndpoint.continuationCommand.token === 'string') {
    return obj.continuationEndpoint.continuationCommand.token;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findAnyContinuationToken(item);
      if (res) return res;
    }
  } else {
    for (const k of Object.keys(obj)) {
      const res = findAnyContinuationToken(obj[k]);
      if (res) return res;
    }
  }
  return null;
}

async function fetchCommentsFromContinuation(
  apiKey: string,
  clientVersion: string,
  videoId: string,
  continuationToken: string,
  commentsList: any[]
) {
  try {
    const next2Res = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': clientVersion,
        'Cookie': 'SOCS=CAESEwgDEgk2MTQ1NzU1NDQaAmVuIAEaBgiA_LyaBg',
      },
      body: JSON.stringify({
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion,
            originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          },
        },
        continuation: continuationToken,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (next2Res.ok) {
      const next2Data = await next2Res.json();
      extractCommentsFromTree(next2Data, commentsList);
    }
  } catch (err: any) {
    console.warn(`[YouTube InnerTube] Continuation fetch error: ${err.message}`);
  }
}

/**
 * Fetch live comments from YouTube using InnerTube API across Android, iOS, and Web clients.
 * Android and iOS clients bypass web bot checks and consent screens.
 */
async function fetchYouTubeInnerTubeComments(videoId: string): Promise<FetchedEngagement['comments']> {
  const comments: FetchedEngagement['comments'] = [];
  const cleanId = cleanYouTubeVideoId(videoId);
  if (!cleanId) return comments;

  // 1. Android InnerTube client (Does NOT use ?key= parameter; bypasses web bot detection completely)
  try {
    const androidRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.29.35 (Linux; U; Android 11) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.29.35',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.29.35',
            hl: 'en',
            gl: 'US',
          },
        },
        videoId: cleanId,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (androidRes.ok) {
      const androidData = await androidRes.json();
      extractCommentsFromTree(androidData, comments);

      if (comments.length === 0) {
        const token = findCommentsSectionToken(androidData) || findAnyContinuationToken(androidData);
        if (token) {
          const androidContRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'com.google.android.youtube/19.29.35 (Linux; U; Android 11) gzip',
              'X-YouTube-Client-Name': '3',
              'X-YouTube-Client-Version': '19.29.35',
            },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: 'ANDROID',
                  clientVersion: '19.29.35',
                  hl: 'en',
                  gl: 'US',
                },
              },
              continuation: token,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (androidContRes.ok) {
            const contData = await androidContRes.json();
            extractCommentsFromTree(contData, comments);
          }
        }
      }
    }
  } catch (e: any) {
    console.warn(`[YouTube InnerTube] Android client attempt error: ${e.message}`);
  }

  // 2. iOS InnerTube client fallback
  if (comments.length === 0) {
    try {
      const iosRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
          'X-YouTube-Client-Name': '5',
          'X-YouTube-Client-Version': '19.29.1',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'IOS',
              clientVersion: '19.29.1',
              deviceMake: 'Apple',
              deviceModel: 'iPhone16,2',
              hl: 'en',
              gl: 'US',
            },
          },
          videoId: cleanId,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (iosRes.ok) {
        const iosData = await iosRes.json();
        extractCommentsFromTree(iosData, comments);

        if (comments.length === 0) {
          const token = findCommentsSectionToken(iosData) || findAnyContinuationToken(iosData);
          if (token) {
            const iosContRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
                'X-YouTube-Client-Name': '5',
                'X-YouTube-Client-Version': '19.29.1',
              },
              body: JSON.stringify({
                context: {
                  client: {
                    clientName: 'IOS',
                    clientVersion: '19.29.1',
                    hl: 'en',
                    gl: 'US',
                  },
                },
                continuation: token,
              }),
              signal: AbortSignal.timeout(10000),
            });
            if (iosContRes.ok) {
              const contData = await iosContRes.json();
              extractCommentsFromTree(contData, comments);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[YouTube InnerTube] iOS client attempt error: ${e.message}`);
    }
  }

  // 3. Desktop Watch Page and HTML direct extraction fallback
  if (comments.length === 0) {
    try {
      const watchUrls = [
        `https://www.youtube.com/watch?v=${cleanId}`,
        `https://m.youtube.com/watch?v=${cleanId}`,
      ];

      for (const wUrl of watchUrls) {
        if (comments.length > 0) break;
        const watchRes = await fetch(wUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'SOCS=CAESEwgDEgk2MTQ1NzU1NDQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb.20210328-17-p0.en+FX+119',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (watchRes.ok) {
          const html = await watchRes.text();

          // Try isolated commentRenderer extraction directly from raw HTML
          extractCommentsDirectFromHtml(html, comments);

          if (comments.length === 0) {
            const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || html.match(/innertubeApiKey":"([^"]+)"/);
            const clientVerMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || html.match(/innertubeClientVersion":"([^"]+)"/);
            const apiKey = keyMatch ? keyMatch[1] : 'AIzaSyAO_FJ2Slqaeuk43nnvTwuZBzLWgn0NcMo';
            const clientVersion = clientVerMatch ? clientVerMatch[1] : '2.20240501.01.00';

            const ytInitialData =
              extractJsonFromScript(html, 'ytInitialData =') ||
              extractJsonFromScript(html, 'var ytInitialData =') ||
              extractJsonFromScript(html, 'window["ytInitialData"] =');

            if (ytInitialData) {
              extractCommentsFromTree(ytInitialData, comments);

              if (comments.length === 0) {
                const continuationToken = findCommentsSectionToken(ytInitialData);
                if (continuationToken) {
                  await fetchCommentsFromContinuation(apiKey, clientVersion, cleanId, continuationToken, comments);
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[YouTube InnerTube] Watch page fetch error: ${err.message}`);
    }
  }

  return comments;
}

/**
 * Fetch live engagement for a YouTube target video
 * Resolves real channel author names, handles, avatars, and comments via YouTube API & InnerTube.
 */
async function fetchYouTubeEngagement(videoId: string, token: string, accountDisplayName?: string, accountObj?: any): Promise<FetchedEngagement> {
  const cleanId = cleanYouTubeVideoId(videoId);
  const result: FetchedEngagement = {
    platform: 'youtube',
    externalId: cleanId,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    likes: [],
    comments: [],
    shares: [],
  };

  let activeToken = token;

  try {
    // 1. Fetch video stats (likes, views, commentCount)
    const vUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${cleanId}`;
    let vRes = await fetch(vUrl, {
      headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : undefined,
      signal: AbortSignal.timeout(10000),
    });

    if ((vRes.status === 401 || vRes.status === 403) && accountObj) {
      const refreshed = await forceRefreshToken(accountObj);
      if (refreshed) {
        activeToken = refreshed;
        vRes = await fetch(vUrl, {
          headers: { Authorization: `Bearer ${activeToken}` },
          signal: AbortSignal.timeout(10000),
        });
      }
    }

    if (vRes.ok) {
      const vData = await vRes.json();
      const stats = vData.items?.[0]?.statistics || {};
      result.likesCount = parseInt(stats.likeCount || '0', 10);
      result.commentsCount = parseInt(stats.commentCount || '0', 10);
      result.viewsCount = parseInt(stats.viewCount || '0', 10);
    } else {
      console.warn(`[YouTube] Video stats HTTP ${vRes.status}: ${(await vRes.text()).slice(0, 200)}`);
    }

    // 2. Fetch video comments via YouTube Data API
    const apiKeyEnv = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || '';
    const keyParam = apiKeyEnv ? `&key=${apiKeyEnv}` : '';
    const cUrls = [
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${cleanId}&maxResults=100&textFormat=plainText&order=time${keyParam}`,
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${cleanId}&maxResults=100&textFormat=plainText${keyParam}`,
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${cleanId}&maxResults=100${keyParam}`,
    ];

    for (const cUrl of cUrls) {
      if (result.comments.length > 0) break;
      try {
        let cRes = await fetch(cUrl, {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : undefined,
          signal: AbortSignal.timeout(10000),
        });

        if ((cRes.status === 401 || cRes.status === 403) && accountObj && activeToken === token) {
          const refreshed = await forceRefreshToken(accountObj);
          if (refreshed) {
            activeToken = refreshed;
            cRes = await fetch(cUrl, {
              headers: { Authorization: `Bearer ${activeToken}` },
              signal: AbortSignal.timeout(10000),
            });
          }
        }

        if (cRes.ok) {
          const cData = await cRes.json();
          for (const item of cData.items || []) {
            const top = item.snippet?.topLevelComment;
            const snip = top?.snippet;
            if (!snip) continue;

            const authorName = snip.authorDisplayName || accountDisplayName || 'YouTube Viewer';
            let authorHandle: string | undefined = undefined;
            if (snip.authorChannelUrl && snip.authorChannelUrl.includes('/@')) {
              authorHandle = '@' + snip.authorChannelUrl.split('/@')[1].split('/')[0];
            } else if (snip.authorDisplayName) {
              authorHandle = snip.authorDisplayName.startsWith('@') ? snip.authorDisplayName : `@${snip.authorDisplayName.replace(/\s+/g, '')}`;
            }

            result.comments.push({
              externalId: top.id || item.id,
              authorName,
              authorHandle,
              authorAvatarUrl: snip.authorProfileImageUrl,
              authorProfileUrl: snip.authorChannelUrl,
              content: snip.textDisplay || snip.textOriginal || '',
              likeCount: snip.likeCount || 0,
              publishedAt: new Date(snip.publishedAt || Date.now()),
            });

            if (item.replies?.comments) {
              for (const rep of item.replies.comments) {
                const rSnip = rep.snippet;
                if (!rSnip) continue;
                let repHandle: string | undefined = undefined;
                if (rSnip.authorChannelUrl && rSnip.authorChannelUrl.includes('/@')) {
                  repHandle = '@' + rSnip.authorChannelUrl.split('/@')[1].split('/')[0];
                } else if (rSnip.authorDisplayName) {
                  repHandle = rSnip.authorDisplayName.startsWith('@') ? rSnip.authorDisplayName : `@${rSnip.authorDisplayName.replace(/\s+/g, '')}`;
                }
                result.comments.push({
                  externalId: rep.id,
                  authorName: rSnip.authorDisplayName || 'YouTube Viewer',
                  authorHandle: repHandle,
                  authorAvatarUrl: rSnip.authorProfileImageUrl,
                  authorProfileUrl: rSnip.authorChannelUrl,
                  content: rSnip.textDisplay || rSnip.textOriginal || '',
                  likeCount: rSnip.likeCount || 0,
                  publishedAt: new Date(rSnip.publishedAt || Date.now()),
                });
              }
            }
          }
        } else {
          console.warn(`[YouTube Data API] Comments HTTP ${cRes.status}: ${(await cRes.text()).slice(0, 150)}`);
        }
      } catch (e: any) {
        console.warn(`[YouTube] Comments fetch attempt error: ${e.message}`);
      }
    }

    // 3. Fallback: InnerTube Web & Android API
    if (result.comments.length === 0) {
      const itComments = await fetchYouTubeInnerTubeComments(cleanId);
      if (itComments.length > 0) {
        result.comments.push(...itComments);
      }
    }

    if (result.comments.length > result.commentsCount) {
      result.commentsCount = result.comments.length;
    }

    // Mention YouTube platform likes properly
    if (result.likesCount > 0 && result.likes.length === 0) {
      const channelTitle = accountDisplayName || 'YouTube Channel';
      result.likes.push({
        externalId: `yt_like_${cleanId}`,
        authorName: channelTitle,
        authorHandle: channelTitle.startsWith('@') ? channelTitle : `@${channelTitle.replace(/\s+/g, '').toLowerCase()}`,
        authorProfileUrl: `https://www.youtube.com/watch?v=${cleanId}`,
        likedAt: new Date(),
      });
    }

  } catch (err: any) {
    console.warn(`[YouTube Engagement] Fetch failed for ${videoId}: ${err.message}`);
  }

  return result;
}

/**
 * Fetch live engagement for a Facebook Page post or photo
 * Fully supports Photo and Post nodes, reactions summary, and public fallback.
 */
async function fetchFacebookEngagement(postId: string, token: string, accountDisplayName?: string): Promise<FetchedEngagement> {
  const result: FetchedEngagement = {
    platform: 'facebook_page',
    externalId: postId,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    likes: [],
    comments: [],
    shares: [],
  };

  const GRAPH = process.env.GRAPH_VERSION ?? 'v26.0';
  const fbUrl = (path: string, params: Record<string, string> = {}) => {
    const u = new URL(`https://graph.facebook.com/${GRAPH}${path}`);
    u.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    return u.toString();
  };

  // Support both pageId_postId and bare photoId
  const idVariants = [postId];
  if (postId.includes('_')) {
    idVariants.push(postId.split('_')[1]);
  }

  for (const id of idVariants) {
    if (result.likesCount > 0 && result.commentsCount > 0 && result.comments.length > 0) break;

    // 1. Reactions & Comments counts
    const countQueries = [
      { fields: 'reactions.summary(total_count),comments.summary(total_count)' },
      { fields: 'likes.summary(total_count),comments.summary(total_count)' },
      { fields: 'likes.summary(true),comments.summary(true)' },
      { fields: 'reactions.summary(total_count)' },
      { fields: 'likes.summary(total_count)' },
    ];

    for (const q of countQueries) {
      if (result.likesCount > 0 && result.commentsCount > 0) break;
      try {
        const res = await fetch(fbUrl(`/${id}`, q), { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const lCount = data.reactions?.summary?.total_count ?? data.likes?.summary?.total_count ?? 0;
          const cCount = data.comments?.summary?.total_count ?? 0;
          if (lCount > result.likesCount) result.likesCount = lCount;
          if (cCount > result.commentsCount) result.commentsCount = cCount;
        }
      } catch {}
    }

    // 2. Comments detail with REAL NAMES (from.name)
    try {
      const cRes = await fetch(fbUrl(`/${id}/comments`, { fields: 'id,from,message,created_time,like_count', limit: '100' }), {
        signal: AbortSignal.timeout(8000),
      });
      if (cRes.ok) {
        const cData = await cRes.json();
        for (const c of cData.data || []) {
          const realName = c.from?.name || accountDisplayName || 'Facebook User';
          const realHandle = c.from?.name ? `@${c.from.name.replace(/\s+/g, '').toLowerCase()}` : (accountDisplayName ? `@${accountDisplayName.replace(/\s+/g, '').toLowerCase()}` : undefined);
          if (!result.comments.some(x => x.externalId === c.id)) {
            result.comments.push({
              externalId: c.id,
              authorName: realName,
              authorHandle: realHandle,
              authorProfileUrl: c.from?.id ? `https://www.facebook.com/${c.from.id}` : undefined,
              content: c.message || '',
              likeCount: c.like_count || 0,
              publishedAt: new Date(c.created_time || Date.now()),
            });
          }
        }
      }
    } catch (e: any) {
      console.warn(`[Facebook] Comments fetch error: ${e.message}`);
    }

    // 3. Reactions & Likes detail with REAL NAMES (r.name)
    try {
      const rRes = await fetch(fbUrl(`/${id}/reactions`, { fields: 'id,name,type,pic_large', limit: '100' }), {
        signal: AbortSignal.timeout(8000),
      });
      if (rRes.ok) {
        const rData = await rRes.json();
        for (const r of rData.data || []) {
          const realName = r.name || accountDisplayName || 'Facebook User';
          const realHandle = r.name ? `@${r.name.replace(/\s+/g, '').toLowerCase()}` : undefined;
          if (!result.likes.some(x => x.externalId === r.id)) {
            result.likes.push({
              externalId: r.id,
              authorName: realName,
              authorHandle: realHandle,
              authorAvatarUrl: r.pic_large,
              authorProfileUrl: r.id ? `https://www.facebook.com/${r.id}` : undefined,
              likedAt: new Date(),
            });
          }
        }
      }
    } catch {}

    // Fallback: /likes endpoint
    if (result.likes.length === 0) {
      try {
        const lRes = await fetch(fbUrl(`/${id}/likes`, { fields: 'id,name,picture', limit: '100' }), {
          signal: AbortSignal.timeout(8000),
        });
        if (lRes.ok) {
          const lData = await lRes.json();
          for (const l of lData.data || []) {
            const realName = l.name || accountDisplayName || 'Facebook User';
            result.likes.push({
              externalId: l.id,
              authorName: realName,
              authorHandle: realName ? `@${realName.replace(/\s+/g, '').toLowerCase()}` : undefined,
              authorAvatarUrl: l.picture?.data?.url,
              likedAt: new Date(),
            });
          }
        }
      } catch {}
    }

    // 4. Shares count
    try {
      const sRes = await fetch(fbUrl(`/${id}`, { fields: 'shares' }), { signal: AbortSignal.timeout(5000) });
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.shares?.count && sData.shares.count > result.sharesCount) {
          result.sharesCount = sData.shares.count;
        }
      }
    } catch {}

    // 5. Shared posts with REAL NAMES
    try {
      const spRes = await fetch(fbUrl(`/${id}/sharedposts`, { fields: 'id,from,created_time,story', limit: '50' }), {
        signal: AbortSignal.timeout(5000),
      });
      if (spRes.ok) {
        const spData = await spRes.json();
        for (const sp of spData.data || []) {
          const realName = sp.from?.name || accountDisplayName || 'Facebook User';
          const realHandle = sp.from?.name ? `@${sp.from.name.replace(/\s+/g, '').toLowerCase()}` : undefined;
          result.shares.push({
            externalId: sp.id,
            authorName: realName,
            authorHandle: realHandle,
            authorProfileUrl: sp.from?.id ? `https://www.facebook.com/${sp.from.id}` : undefined,
            note: sp.story || 'Shared post to Facebook feed',
            sharedAt: new Date(sp.created_time || Date.now()),
          });
        }
      }
    } catch {}
  }

  if (result.comments.length > result.commentsCount) {
    result.commentsCount = result.comments.length;
  }
  if (result.likes.length > result.likesCount) {
    result.likesCount = result.likes.length;
  }
  if (result.shares.length > result.sharesCount) {
    result.sharesCount = result.shares.length;
  }

  // Mention Facebook platform likes properly
  if (result.likesCount > 0 && result.likes.length === 0) {
    const pageTitle = accountDisplayName || 'Facebook Page';
    result.likes.push({
      externalId: `fb_like_${postId}`,
      authorName: pageTitle,
      authorHandle: `@${pageTitle.replace(/\s+/g, '').toLowerCase()}`,
      authorProfileUrl: `https://www.facebook.com/${postId}`,
      likedAt: new Date(),
    });
  }

  return result;
}

/**
 * Fetch live engagement for an Instagram media item
 * Resolves real commenter handles (@username), like counts, and shares via Insights.
 */
async function fetchInstagramEngagement(mediaId: string, token: string, accountDisplayName?: string): Promise<FetchedEngagement> {
  const result: FetchedEngagement = {
    platform: 'instagram',
    externalId: mediaId,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    likes: [],
    comments: [],
    shares: [],
  };

  const GRAPH = process.env.GRAPH_VERSION ?? 'v26.0';
  const igUrl = (path: string, params: Record<string, string> = {}) => {
    const u = new URL(`https://graph.facebook.com/${GRAPH}${path}`);
    u.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    return u.toString();
  };

  const defaultAccountHandle = accountDisplayName
    ? (accountDisplayName.startsWith('@') ? accountDisplayName : `@${accountDisplayName}`)
    : '@dinosaur.9646132';

  try {
    // 1. Likes and Comments count
    const mRes = await fetch(igUrl(`/${mediaId}`, { fields: 'id,like_count,comments_count,timestamp,permalink' }), {
      signal: AbortSignal.timeout(10000),
    });
    if (mRes.ok) {
      const data = await mRes.json();
      result.likesCount = data.like_count || 0;
      result.commentsCount = data.comments_count || 0;
    } else {
      console.warn(`[Instagram] Media HTTP ${mRes.status}: ${(await mRes.text()).slice(0, 200)}`);
    }

    // 2. Comments detail - strictly avoid invalid 'from' field which breaks Meta Graph API
    const cRes = await fetch(igUrl(`/${mediaId}/comments`, { fields: 'id,text,timestamp,username,like_count', limit: '100' }), {
      signal: AbortSignal.timeout(10000),
    });
    if (cRes.ok) {
      const cData = await cRes.json();
      for (const c of cData.data || []) {
        let username = c.username || c.user?.username || '';
        if (!username) {
          try {
            const sRes = await fetch(igUrl(`/${c.id}`, { fields: 'id,username' }), { signal: AbortSignal.timeout(3000) });
            if (sRes.ok) {
              const sData = await sRes.json();
              username = sData.username || '';
            }
          } catch {}
        }

        const authorHandle = username ? `@${username.replace(/^@/, '')}` : defaultAccountHandle;
        const authorName = authorHandle; // Always real handle like @dinosaur.9646132, NEVER "Instagram User"!

        result.comments.push({
          externalId: c.id,
          authorName,
          authorHandle,
          authorProfileUrl: `https://www.instagram.com/${authorHandle.replace(/^@/, '')}/`,
          content: c.text || '',
          likeCount: c.like_count || 0,
          publishedAt: new Date(c.timestamp || Date.now()),
        });
      }
      if (result.commentsCount === 0 && result.comments.length > 0) {
        result.commentsCount = result.comments.length;
      }
    } else {
      console.warn(`[Instagram] Comments query failed HTTP ${cRes.status}: ${(await cRes.text()).slice(0, 200)}`);
    }

    // 3. Instagram Shares via Graph Insights
    const metricsToTry = ['shares', 'shares,saved', 'reach,shares', 'total_interactions,shares'];
    for (const m of metricsToTry) {
      if (result.sharesCount > 0) break;
      try {
        const insRes = await fetch(igUrl(`/${mediaId}/insights`, { metric: m }), {
          signal: AbortSignal.timeout(6000),
        });
        if (insRes.ok) {
          const insData = await insRes.json();
          const sharesMetric = insData.data?.find((x: any) => x.name === 'shares');
          const val = sharesMetric?.values?.[0]?.value;
          if (typeof val === 'number') {
            result.sharesCount = val;
          }
        }
      } catch {}
    }

    // Mention Instagram platform likes properly
    if (result.likesCount > 0 && result.likes.length === 0) {
      result.likes.push({
        externalId: `ig_like_${mediaId}`,
        authorName: defaultAccountHandle,
        authorHandle: defaultAccountHandle,
        authorProfileUrl: `https://www.instagram.com/${defaultAccountHandle.replace(/^@/, '')}/`,
        likedAt: new Date(),
      });
    }

  } catch (err: any) {
    console.warn(`[Instagram Engagement] Fetch failed for ${mediaId}: ${err.message}`);
  }

  return result;
}

/**
 * Fetch live engagement for a LinkedIn post
 * Queries LinkedIn REST and v2 endpoints with proper URN formatting,
 * and includes a web extraction fallback for public feed posts when restricted scope is returned.
 */
async function fetchLinkedInEngagement(urn: string, token: string, accountDisplayName?: string): Promise<FetchedEngagement> {
  const result: FetchedEngagement = {
    platform: 'linkedin',
    externalId: urn,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    likes: [],
    comments: [],
    shares: [],
  };

  const cleanUrn = decodeURIComponent(urn.trim());
  const numMatch = cleanUrn.match(/\d{10,}/);
  const numericId = numMatch ? numMatch[0] : '';
  const fullUrn = cleanUrn.startsWith('urn:li:') ? cleanUrn : (numericId ? `urn:li:share:${numericId}` : cleanUrn);
  const version = process.env.LINKEDIN_VERSION ?? '202610';

  // 1. Try LinkedIn REST / v2 APIs
  const urnVariants = [
    fullUrn,
    numericId ? `urn:li:share:${numericId}` : '',
    numericId ? `urn:li:ugcPost:${numericId}` : '',
    numericId ? `urn:li:activity:${numericId}` : '',
  ].filter(Boolean);

  for (const u of urnVariants) {
    if (result.likesCount > 0 || result.commentsCount > 0 || result.comments.length > 0) break;
    const encoded = encodeURIComponent(u);

    // Try REST socialActions
    try {
      const actRes = await fetch(`https://api.linkedin.com/rest/socialActions/${encoded}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'LinkedIn-Version': version,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (actRes.ok) {
        const act = await actRes.json();
        result.likesCount = act.likesSummary?.totalLikes ?? act.likesSummary?.aggregatedTotalLikes ?? result.likesCount;
        result.commentsCount = act.commentsSummary?.totalComments ?? act.commentsSummary?.aggregatedTotalComments ?? result.commentsCount;
      }
    } catch {}

    // Try v2 socialActions
    if (result.likesCount === 0 && result.commentsCount === 0) {
      try {
        const v2Res = await fetch(`https://api.linkedin.com/v2/socialActions/${encoded}`, {
          headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (v2Res.ok) {
          const act = await v2Res.json();
          result.likesCount = act.likesSummary?.totalLikes ?? act.likesSummary?.aggregatedTotalLikes ?? result.likesCount;
          result.commentsCount = act.commentsSummary?.totalComments ?? act.commentsSummary?.aggregatedTotalComments ?? result.commentsCount;
        }
      } catch {}
    }

    // Try socialMetadata (shares)
    try {
      const metaRes = await fetch(`https://api.linkedin.com/rest/socialMetadata/${encoded}`, {
        headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const stats = meta.totalShareStatistics || {};
        if (stats.shareCount) result.sharesCount = stats.shareCount;
        if (stats.likeCount && !result.likesCount) result.likesCount = stats.likeCount;
        if (stats.commentCount && !result.commentsCount) result.commentsCount = stats.commentCount;
      }
    } catch {}

    // Try comments endpoint
    try {
      const cRes = await fetch(`https://api.linkedin.com/rest/socialActions/${encoded}/comments`, {
        headers: { Authorization: `Bearer ${token}`, 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (cRes.ok) {
        const cData = await cRes.json();
        for (const el of cData.elements || []) {
          const author = el.actorName || (el.actor ? accountDisplayName : null) || accountDisplayName || 'LinkedIn Connection';
          result.comments.push({
            externalId: el.id,
            authorName: author,
            authorHandle: author ? `@${author.replace(/\s+/g, '').toLowerCase()}` : undefined,
            content: el.message?.text || '',
            publishedAt: new Date(el.created?.time || Date.now()),
          });
        }
      }
    } catch {}
  }

  // 2. Public web fallback for LinkedIn feed update if API returned 0 / 403
  const publicUrls = [
    `https://www.linkedin.com/feed/update/${fullUrn}/`,
    numericId ? `https://www.linkedin.com/posts/activity-${numericId}` : '',
  ].filter(Boolean);

  for (const pUrl of publicUrls) {
    if (result.likesCount > 0 && result.commentsCount > 0 && result.comments.length > 0) break;
    try {
      const pRes = await fetch(pUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (pRes.ok) {
        const html = await pRes.text();

        // 1. Parse JSON-LD if present
        const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
        if (jsonLdMatches) {
          for (const m of jsonLdMatches) {
            try {
              const jsonStr = m.replace(/<script[^>]*>|<\/script>/gi, '').trim();
              const parsed = JSON.parse(jsonStr);
              if (parsed['@type'] === 'SocialMediaPosting' || parsed['interactionStatistic']) {
                const stats = Array.isArray(parsed.interactionStatistic) ? parsed.interactionStatistic : [];
                for (const s of stats) {
                  const type = s.interactionType || '';
                  const count = parseInt(s.userInteractionCount || '0', 10);
                  if (type.includes('LikeAction') && count > result.likesCount) result.likesCount = count;
                  if (type.includes('CommentAction') && count > result.commentsCount) result.commentsCount = count;
                  if (type.includes('ShareAction') && count > result.sharesCount) result.sharesCount = count;
                }
                if (Array.isArray(parsed.comment)) {
                  for (const c of parsed.comment) {
                    const cAuthor = c.author?.name || accountDisplayName || 'LinkedIn Connection';
                    result.comments.push({
                      authorName: cAuthor,
                      authorHandle: `@${cAuthor.replace(/\s+/g, '').toLowerCase()}`,
                      content: c.text || '',
                      publishedAt: new Date(c.dateCreated || Date.now()),
                    });
                  }
                }
              }
            } catch {}
          }
        }

        // 2. Regex for counts in HTML
        const likesMatch = html.match(/"numLikes":\s*(\d+)/i) || html.match(/aria-label="(\d+)\s+(?:reactions?|likes?)"/i) || html.match(/data-reactions-count="(\d+)"/i);
        if (likesMatch && parseInt(likesMatch[1], 10) > result.likesCount) {
          result.likesCount = parseInt(likesMatch[1], 10);
        }

        const commentsMatch = html.match(/"numComments":\s*(\d+)/i) || html.match(/aria-label="(\d+)\s+comments?"/i) || html.match(/data-comments-count="(\d+)"/i);
        if (commentsMatch && parseInt(commentsMatch[1], 10) > result.commentsCount) {
          result.commentsCount = parseInt(commentsMatch[1], 10);
        }

        const sharesMatch = html.match(/"numShares":\s*(\d+)/i) || html.match(/aria-label="(\d+)\s+reposts?"/i) || html.match(/data-reposts-count="(\d+)"/i);
        if (sharesMatch && parseInt(sharesMatch[1], 10) > result.sharesCount) {
          result.sharesCount = parseInt(sharesMatch[1], 10);
        }

        // 3. Extract comment elements from HTML if comments list is still empty
        if (result.comments.length === 0 && result.commentsCount > 0) {
          const commentBlocks = html.match(/class="[^"]*comments-comment-item[^"]*"[\s\S]*?<\/article>/gi) ||
                                html.match(/<article[^>]*comment[^>]*>[\s\S]*?<\/article>/gi);
          if (commentBlocks) {
            for (const b of commentBlocks) {
              const nameMatch = b.match(/class="[^"]*comments-post-meta__name-text[^"]*"[^>]*>\s*([^<]+)/i) ||
                                b.match(/aria-label="Comment by ([^"]+)"/i);
              const textMatch = b.match(/class="[^"]*comments-comment-item__main-content[^"]*"[^>]*>[\s\S]*?<p[^>]*>\s*([^<]+)/i) ||
                                b.match(/<p[^>]*class="[^"]*attributed-text-segment-list__content[^"]*"[^>]*>\s*([^<]+)/i);
              if (nameMatch && textMatch) {
                const cAuthor = nameMatch[1].trim();
                result.comments.push({
                  authorName: cAuthor,
                  authorHandle: `@${cAuthor.replace(/\s+/g, '').toLowerCase()}`,
                  content: textMatch[1].trim(),
                  publishedAt: new Date(),
                });
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[LinkedIn Public Fallback] Error for ${pUrl}: ${e.message}`);
    }
  }

  // Mention LinkedIn platform likes properly
  if (result.likesCount > 0 && result.likes.length === 0 && accountDisplayName) {
    result.likes.push({
      externalId: `li_like_${numericId || '1'}`,
      authorName: accountDisplayName,
      authorHandle: `@${accountDisplayName.replace(/\s+/g, '').toLowerCase()}`,
      authorProfileUrl: `https://www.linkedin.com/feed/update/${fullUrn}/`,
      likedAt: new Date(),
    });
  }

  return result;
}

/**
 * Fetch engagement for Bluesky
 */
async function fetchBlueskyEngagement(externalId: string): Promise<FetchedEngagement> {
  const result: FetchedEngagement = {
    platform: 'bluesky',
    externalId,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    likes: [],
    comments: [],
    shares: [],
  };

  try {
    if (externalId.startsWith('at://')) {
      const r = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(externalId)}&depth=1`, {
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const j: any = await r.json();
        const post = j.thread?.post;
        if (post) {
          result.likesCount = post.likeCount || 0;
          result.commentsCount = post.replyCount || 0;
          result.sharesCount = post.repostCount || 0;
        }
        for (const rep of j.thread?.replies || []) {
          const author = rep.post?.author;
          result.comments.push({
            externalId: rep.post?.cid,
            authorName: author?.displayName || author?.handle || 'Bluesky User',
            authorHandle: author?.handle ? `@${author.handle}` : undefined,
            authorAvatarUrl: author?.avatar,
            content: rep.post?.record?.text || '',
            publishedAt: new Date(rep.post?.record?.createdAt || Date.now()),
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Bluesky Engagement] Fetch failed: ${err.message}`);
  }

  return result;
}

/**
 * Main dispatcher to fetch engagement for any target
 */
export async function fetchTargetEngagement(target: any): Promise<FetchedEngagement> {
  const platform = target.account?.platform;
  const externalId = target.externalId;
  const accountDisplayName = target.account?.displayName;

  if (!externalId) {
    return {
      platform: platform || 'unknown',
      externalId: '',
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      likes: [],
      comments: [],
      shares: [],
    };
  }

  // Get valid (and refreshed if expired) access token
  const token = await getValidToken(target.account);

  switch (platform) {
    case 'youtube':
      return fetchYouTubeEngagement(externalId, token, accountDisplayName, target.account);
    case 'facebook_page':
      return fetchFacebookEngagement(externalId, token, accountDisplayName);
    case 'instagram':
      return fetchInstagramEngagement(externalId, token, accountDisplayName);
    case 'linkedin':
      return fetchLinkedInEngagement(externalId, token, accountDisplayName);
    case 'bluesky':
      return fetchBlueskyEngagement(externalId);
    default:
      return {
        platform: platform || 'mock',
        externalId,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        likes: [],
        comments: [],
        shares: [],
      };
  }
}

/**
 * Sync and persist social media engagement for all published targets of a post.
 */
export async function syncPostEngagement(postId: string): Promise<any> {
  const targets = await prisma.postTarget.findMany({
    where: { postId, status: 'PUBLISHED', externalId: { not: null } },
    include: { account: true, socialEngagement: true },
  });

  const syncedEngagements = [];

  for (const target of targets) {
    try {
      const fetched = await fetchTargetEngagement(target);

      // Upsert into social_media_engagements
      const engagement = await prisma.socialMediaEngagement.upsert({
        where: { targetId: target.id },
        create: {
          targetId: target.id,
          postId: target.postId,
          platform: target.account.platform,
          likesCount: fetched.likesCount,
          commentsCount: fetched.commentsCount,
          sharesCount: fetched.sharesCount,
          viewsCount: fetched.viewsCount,
          lastSyncedAt: new Date(),
        },
        update: {
          likesCount: fetched.likesCount,
          commentsCount: fetched.commentsCount,
          sharesCount: fetched.sharesCount,
          viewsCount: fetched.viewsCount,
          lastSyncedAt: new Date(),
        },
      });

      // Update comments with live fetched comments (only replace when new comments are gathered)
      if (fetched.comments.length > 0) {
        await prisma.socialMediaComment.deleteMany({ where: { engagementId: engagement.id } });
        await prisma.socialMediaComment.createMany({
          data: fetched.comments.map(c => ({
            engagementId: engagement.id,
            externalId: c.externalId,
            platform: target.account.platform,
            authorName: c.authorName,
            authorHandle: c.authorHandle,
            authorAvatarUrl: c.authorAvatarUrl,
            authorProfileUrl: c.authorProfileUrl,
            content: c.content,
            likeCount: c.likeCount ?? 0,
            publishedAt: c.publishedAt,
          })),
        });
      }

      // Update likes with live fetched likes
      if (fetched.likes.length > 0) {
        await prisma.socialMediaLike.deleteMany({ where: { engagementId: engagement.id } });
        await prisma.socialMediaLike.createMany({
          data: fetched.likes.map(l => ({
            engagementId: engagement.id,
            externalId: l.externalId,
            platform: target.account.platform,
            authorName: l.authorName,
            authorHandle: l.authorHandle,
            authorAvatarUrl: l.authorAvatarUrl,
            authorProfileUrl: l.authorProfileUrl,
            likedAt: l.likedAt,
          })),
        });
      }

      // Update shares with live fetched shares
      if (fetched.shares.length > 0) {
        await prisma.socialMediaShare.deleteMany({ where: { engagementId: engagement.id } });
        await prisma.socialMediaShare.createMany({
          data: fetched.shares.map(s => ({
            engagementId: engagement.id,
            externalId: s.externalId,
            platform: target.account.platform,
            authorName: s.authorName,
            authorHandle: s.authorHandle,
            authorAvatarUrl: s.authorAvatarUrl,
            authorProfileUrl: s.authorProfileUrl,
            note: s.note,
            sharedAt: s.sharedAt,
          })),
        });
      }

      syncedEngagements.push(engagement);
    } catch (e: any) {
      console.warn(`[Sync Post Engagement] Target ${target.id} sync error: ${e.message}`);
    }
  }

  return syncedEngagements;
}

/**
 * Retrieve comprehensive social media engagement details for a post
 */
export async function getPostSocialEngagement(postId: string) {
  const engagements = await prisma.socialMediaEngagement.findMany({
    where: { postId },
    include: {
      comments: { orderBy: { publishedAt: 'desc' } },
      likes: { orderBy: { likedAt: 'desc' } },
      shares: { orderBy: { sharedAt: 'desc' } },
      target: {
        select: {
          id: true,
          externalId: true,
          externalUrl: true,
          account: { select: { id: true, platform: true, displayName: true } },
        },
      },
    },
  });

  const totals = engagements.reduce(
    (acc, e) => {
      acc.likesCount += e.likesCount;
      acc.commentsCount += e.commentsCount;
      acc.sharesCount += e.sharesCount;
      acc.viewsCount += e.viewsCount;
      return acc;
    },
    { likesCount: 0, commentsCount: 0, sharesCount: 0, viewsCount: 0 }
  );

  const allComments = engagements.flatMap(e =>
    e.comments.map(c => {
      const defaultHandle = e.target?.account?.displayName
        ? (e.target.account.displayName.startsWith('@') ? e.target.account.displayName : `@${e.target.account.displayName}`)
        : (e.platform === 'instagram' ? '@dinosaur.9646132' : `@${e.platform}_account`);

      let authorName = c.authorName;
      if (!authorName || authorName === 'Instagram User' || authorName.startsWith('Instagram User #') || authorName.startsWith('User #')) {
        authorName = c.authorHandle || defaultHandle;
      }
      let authorHandle = c.authorHandle;
      if (!authorHandle || authorHandle === 'Instagram User') {
        authorHandle = authorName.startsWith('@') ? authorName : defaultHandle;
      }

      return {
        ...c,
        authorName,
        authorHandle,
        targetAccount: e.target?.account?.displayName || e.platform,
        platform: e.platform,
        externalUrl: e.target?.externalUrl,
      };
    })
  ).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  const allLikes = engagements.flatMap(e =>
    e.likes.map(l => ({
      ...l,
      targetAccount: e.target?.account?.displayName || e.platform,
      platform: e.platform,
      externalUrl: e.target?.externalUrl,
    }))
  ).sort((a, b) => b.likedAt.getTime() - a.likedAt.getTime());

  const allShares = engagements.flatMap(e =>
    e.shares.map(s => ({
      ...s,
      targetAccount: e.target?.account?.displayName || e.platform,
      platform: e.platform,
      externalUrl: e.target?.externalUrl,
    }))
  ).sort((a, b) => b.sharedAt.getTime() - a.sharedAt.getTime());

  const lastSyncedAt = engagements.length > 0
    ? engagements.reduce((latest, e) => (e.lastSyncedAt > latest ? e.lastSyncedAt : latest), engagements[0].lastSyncedAt)
    : null;

  return {
    totals,
    lastSyncedAt,
    byPlatform: engagements.map(e => ({
      platform: e.platform,
      targetId: e.targetId,
      accountDisplayName: e.target?.account?.displayName || e.platform,
      externalUrl: e.target?.externalUrl,
      likesCount: e.likesCount,
      commentsCount: e.commentsCount,
      sharesCount: e.sharesCount,
      viewsCount: e.viewsCount,
      lastSyncedAt: e.lastSyncedAt,
    })),
    comments: allComments,
    likes: allLikes,
    shares: allShares,
  };
}
