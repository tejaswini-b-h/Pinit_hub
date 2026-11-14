import { useEffect, useState } from 'react';
import { api, PostRow, PostSocialEngagementData, PLATFORM_LABEL } from '../api';
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
  BlueskyIcon,
  TelegramIcon,
} from './Icons';

interface EngagementModalProps {
  post: PostRow;
  initialTab?: 'overview' | 'comments' | 'likes';
  onClose: () => void;
  onPostUpdated?: (updated: Partial<PostRow>) => void;
}

const fmtExactDateTime = (dateStr?: string | null) => {
  if (!dateStr) return 'Not yet synced';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function EngagementModal({ post, initialTab = 'overview', onClose, onPostUpdated }: EngagementModalProps) {
  const [tab, setTab] = useState<'overview' | 'comments' | 'likes'>(initialTab);
  const [data, setData] = useState<PostSocialEngagementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const getPlatformIcon = (platform: string, className = "w-4 h-4") => {
    switch (platform) {
      case 'linkedin': return <LinkedInIcon className={`${className} text-[#0A66C2]`} />;
      case 'facebook_page': return <FacebookIcon className={`${className} text-[#1877F2]`} />;
      case 'instagram': return <InstagramIcon className={`${className} text-[#E4405F]`} />;
      case 'youtube': return <YouTubeIcon className={`${className} text-[#FF0000]`} />;
      case 'bluesky': return <BlueskyIcon className={`${className} text-[#0285FF]`} />;
      case 'telegram': return <TelegramIcon className={`${className} text-[#229ED9]`} />;
      default: return null;
    }
  };

  const loadEngagement = async (sync = false) => {
    if (sync) setSyncing(true);
    else setLoading(true);
    setErr('');
    try {
      const endpoint = sync
        ? `/posts/${post.id}/sync-social-engagement`
        : `/posts/${post.id}/social-engagement`;
      const res = await api<PostSocialEngagementData>(endpoint, {
        method: sync ? 'POST' : 'GET',
      });
      setData(res);
      if (sync) {
        setStatusMsg('Social media engagement successfully gathered from connected platforms!');
        setTimeout(() => setStatusMsg(''), 4000);
      }
      if (onPostUpdated && res.totals) {
        onPostUpdated({
          likesCount: res.totals.likesCount,
          commentsCount: res.totals.commentsCount,
          sharesCount: res.totals.sharesCount,
          viewsCount: res.totals.viewsCount,
          lastSyncedAt: res.lastSyncedAt,
          byPlatform: res.byPlatform,
        });
      }
    } catch (e: any) {
      setErr(e.message || 'Could not fetch engagement from social media.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadEngagement(false);
  }, [post.id]);

  const totals = data?.totals ?? {
    likesCount: post.likesCount ?? 0,
    commentsCount: post.commentsCount ?? 0,
    sharesCount: post.sharesCount ?? 0,
    viewsCount: post.viewsCount ?? 0,
  };

  const comments = data?.comments ?? [];
  const likes = data?.likes ?? [];
  const shares = data?.shares ?? [];
  const byPlatform = data?.byPlatform ?? post.byPlatform ?? [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-start justify-between bg-slate-50/80">
          <div className="min-w-0 pr-4 space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Live Social Media Engagement Tracking
              </h3>
            </div>
            <p className="text-xs text-slate-500 line-clamp-1 italic">
              {post.body ? `"${post.body}"` : '(Media upload only)'}
            </p>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-500">Published to:</span>
              {post.targets.map(t => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-700 shadow-2xs"
                >
                  {getPlatformIcon(t.account.platform, "w-3 h-3")}
                  <span>{PLATFORM_LABEL[t.account.platform] ?? t.account.platform}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => loadEngagement(true)}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition disabled:opacity-50"
              title="Sync latest live interactions from YouTube, Facebook, Instagram, LinkedIn"
            >
              <span className={syncing ? 'animate-spin' : ''}>🔄</span>
              <span>{syncing ? 'Gathering...' : 'Sync from Social Media'}</span>
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition font-semibold"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 3 KPI Metric Cards */}
        <div className="grid grid-cols-3 gap-2.5 p-4 border-b border-slate-200 bg-white">
          <div
            onClick={() => setTab('likes')}
            className={`p-3 rounded-xl border cursor-pointer transition ${
              tab === 'likes' ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200 bg-slate-50/40 hover:bg-slate-50'
            }`}
          >
            <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">Total Likes</span>
            <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totals.likesCount}</span>
          </div>

          <div
            onClick={() => setTab('comments')}
            className={`p-3 rounded-xl border cursor-pointer transition ${
              tab === 'comments' ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 bg-slate-50/40 hover:bg-slate-50'
            }`}
          >
            <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider block">Comments</span>
            <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totals.commentsCount}</span>
          </div>

          <div
            onClick={() => setTab('overview')}
            className={`p-3 rounded-xl border cursor-pointer transition ${
              tab === 'overview' ? 'border-purple-300 bg-purple-50/50' : 'border-slate-200 bg-slate-50/40 hover:bg-slate-50'
            }`}
          >
            <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">Video Views</span>
            <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totals.viewsCount}</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1 sm:gap-3">
            <button
              onClick={() => setTab('overview')}
              className={`py-3 px-2.5 text-xs font-bold border-b-2 transition whitespace-nowrap ${
                tab === 'overview' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              📊 Channel Overview
            </button>
            <button
              onClick={() => setTab('comments')}
              className={`py-3 px-2.5 text-xs font-bold border-b-2 transition whitespace-nowrap ${
                tab === 'comments' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              💬 Social Comments ({comments.length || totals.commentsCount})
            </button>
            <button
              onClick={() => setTab('likes')}
              className={`py-3 px-2.5 text-xs font-bold border-b-2 transition whitespace-nowrap ${
                tab === 'likes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              ❤️ Likes Breakdown ({likes.length || totals.likesCount})
            </button>
          </div>

          <span className="text-[10px] text-slate-400 font-medium py-2">
            Synced: {fmtExactDateTime(data?.lastSyncedAt || post.lastSyncedAt)}
          </span>
        </div>

        {/* Alerts */}
        {err && (
          <div className="mx-5 mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center justify-between">
            <span>{err}</span>
            <button onClick={() => setErr('')} className="font-bold opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {statusMsg && (
          <div className="mx-5 mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700 flex items-center justify-between">
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg('')} className="font-bold opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-16 text-center space-y-2">
              <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs text-slate-500 font-medium">Gathering engagement from social media channels...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {tab === 'overview' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Platform by Platform Engagement
                    </span>
                    <button
                      onClick={() => loadEngagement(true)}
                      disabled={syncing}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {syncing ? 'Gathering live stats...' : 'Refresh now'}
                    </button>
                  </div>

                  {byPlatform.length === 0 ? (
                    <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-2">
                      <p className="text-sm font-semibold text-slate-700">No live engagement recorded yet</p>
                      <p className="text-xs text-slate-400">
                        Click &ldquo;Sync from Social Media&rdquo; above to query the social media platform APIs directly.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {byPlatform.map((stat, idx) => (
                        <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="p-1.5 rounded-lg bg-slate-50 border border-slate-100">
                                {getPlatformIcon(stat.platform, "w-4 h-4")}
                              </span>
                              <div>
                                <h4 className="text-xs font-bold text-slate-900">{stat.accountDisplayName}</h4>
                                <span className="text-[10px] text-slate-400">{PLATFORM_LABEL[stat.platform] ?? stat.platform}</span>
                              </div>
                            </div>
                            {stat.externalUrl && (
                              <a
                                href={stat.externalUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-semibold text-indigo-600 hover:underline"
                              >
                                View live post &rarr;
                              </a>
                            )}
                          </div>

                          <div className={`grid ${stat.platform === 'youtube' ? 'grid-cols-3' : 'grid-cols-2'} gap-2 pt-2 border-t border-slate-100 text-center`}>
                            <div className="bg-slate-50 p-2 rounded-lg">
                              <span className="text-[10px] text-slate-500 font-bold block">Likes</span>
                              <span className="text-sm font-bold text-slate-800">{stat.likesCount}</span>
                            </div>
                            <div className="bg-slate-50 p-2 rounded-lg">
                              <span className="text-[10px] text-slate-500 font-bold block">Comments</span>
                              <span className="text-sm font-bold text-slate-800">{stat.commentsCount}</span>
                            </div>
                            {stat.platform === 'youtube' && (
                              <div className="bg-slate-50 p-2 rounded-lg">
                                <span className="text-[10px] text-slate-500 font-bold block">Video Views</span>
                                <span className="text-sm font-bold text-slate-800">{stat.viewsCount}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: COMMENTS FROM SOCIAL MEDIA */}
              {tab === 'comments' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Comments Left by Accounts on Social Media ({comments.length > 0 ? comments.length : totals.commentsCount})
                    </span>
                    <button
                      onClick={() => loadEngagement(true)}
                      disabled={syncing}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {syncing ? 'Syncing...' : 'Fetch latest comments'}
                    </button>
                  </div>

                  {comments.length === 0 ? (
                    <div className="p-8 sm:p-12 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-3">
                      <p className="text-sm font-semibold text-slate-700">
                        {totals.commentsCount > 0
                          ? `${totals.commentsCount} comments recorded on social media`
                          : 'No comments found on social media'}
                      </p>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        {totals.commentsCount > 0
                          ? 'Click the button below to sync the latest comment threads and commenter profiles directly from connected platforms.'
                          : 'When viewers or connections comment on YouTube, Facebook, Instagram, or LinkedIn, their comments will appear here with author name and timestamp.'}
                      </p>
                      <button
                        onClick={() => loadEngagement(true)}
                        disabled={syncing}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold shadow-2xs hover:bg-indigo-700 transition"
                      >
                        🔄 {syncing ? 'Gathering comments...' : 'Fetch Comments Now'}
                      </button>
                      {post.targets?.some(t => t.account.platform === 'youtube') && totals.commentsCount > 0 && (
                        <div className="pt-2 flex flex-col items-center gap-1.5">
                          <p className="text-[11px] text-slate-500">
                            YouTube comment threads require Google comment permissions on your connected channel:
                          </p>
                          <a
                            href="#accounts"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition shadow-2xs"
                          >
                            <span>▶️</span>
                            <span>Reconnect YouTube in Connected Accounts</span>
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {comments.map(c => {
                        const defaultHandle = c.targetAccount ? (c.targetAccount.startsWith('@') ? c.targetAccount : `@${c.targetAccount}`) : (c.platform === 'instagram' ? '@dinosaur.9646132' : `@${c.platform}_account`);
                        const cleanName = (!c.authorName || c.authorName === 'Instagram User' || c.authorName.startsWith('Instagram User #') || c.authorName.startsWith('User #'))
                          ? (c.authorHandle || defaultHandle)
                          : c.authorName;
                        const cleanHandle = (c.authorHandle && c.authorHandle !== 'Instagram User')
                          ? c.authorHandle
                          : (cleanName.startsWith('@') ? cleanName : defaultHandle);

                        return (
                          <div key={c.id} className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                {c.authorAvatarUrl ? (
                                  <img
                                    src={c.authorAvatarUrl}
                                    alt={cleanName}
                                    className="w-8 h-8 rounded-full object-cover border border-slate-200"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-white flex items-center justify-center font-bold text-xs uppercase">
                                    {cleanName.replace(/^@/, '').slice(0, 2)}
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {c.authorProfileUrl ? (
                                      <a
                                        href={c.authorProfileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-bold text-slate-900 hover:text-indigo-600 transition"
                                      >
                                        {cleanName}
                                      </a>
                                    ) : (
                                      <span className="text-xs font-bold text-slate-900">{cleanName}</span>
                                    )}
                                    {cleanHandle && cleanHandle !== cleanName && (
                                      <span className="text-[11px] text-slate-500 font-mono">{cleanHandle}</span>
                                    )}
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                                      {getPlatformIcon(c.platform, "w-2.5 h-2.5")}
                                      <span>{PLATFORM_LABEL[c.platform] ?? c.platform}</span>
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400 block">
                                    {fmtExactDateTime(c.publishedAt)}
                                  </span>
                                </div>
                              </div>

                              {c.likeCount !== undefined && c.likeCount > 0 && (
                                <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                                  ❤️ {c.likeCount}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-800 pl-10 leading-relaxed whitespace-pre-wrap">
                              {c.content}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: LIKES FROM SOCIAL MEDIA */}
              {tab === 'likes' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Likes & Reactions Gathered from Platforms ({likes.length > 0 ? likes.length : totals.likesCount})
                    </span>
                    <button
                      onClick={() => loadEngagement(true)}
                      disabled={syncing}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {syncing ? 'Syncing...' : 'Fetch latest likes'}
                    </button>
                  </div>

                  {/* Platform-by-Platform Like Counts Summary */}
                  {byPlatform.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                      {byPlatform.map((bp, i) => (
                        <div key={i} className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="p-1 rounded bg-slate-50 border border-slate-100 shrink-0">
                              {getPlatformIcon(bp.platform, "w-3.5 h-3.5")}
                            </span>
                            <div className="min-w-0">
                              <span className="text-[11px] font-bold text-slate-800 block truncate">{bp.accountDisplayName}</span>
                              <span className="text-[10px] text-slate-400 block">{PLATFORM_LABEL[bp.platform] ?? bp.platform}</span>
                            </div>
                          </div>
                          <span className="text-xs font-bold text-rose-600 shrink-0 ml-2">{bp.likesCount} {bp.likesCount === 1 ? 'Like' : 'Likes'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {likes.length > 0 ? (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white shadow-2xs overflow-hidden">
                      {likes.map(l => {
                        const defaultHandle = l.targetAccount ? (l.targetAccount.startsWith('@') ? l.targetAccount : `@${l.targetAccount}`) : (l.platform === 'instagram' ? '@dinosaur.9646132' : `@${l.platform}_account`);
                        const cleanName = (!l.authorName || l.authorName === 'Instagram User' || l.authorName.includes('#') || l.authorName === 'Facebook User' || l.authorName === 'LinkedIn Member')
                          ? (l.authorHandle || defaultHandle)
                          : l.authorName;
                        const cleanHandle = l.authorHandle || (cleanName.startsWith('@') ? cleanName : defaultHandle);

                        return (
                          <div key={l.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50/60 transition">
                            <div className="flex items-center gap-3">
                              {l.authorAvatarUrl ? (
                                <img src={l.authorAvatarUrl} alt={cleanName} className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-500 to-indigo-500 text-white flex items-center justify-center font-bold text-xs uppercase">
                                  {cleanName.replace(/^@/, '').slice(0, 2)}
                                </div>
                              )}
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {l.authorProfileUrl ? (
                                    <a
                                      href={l.authorProfileUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs font-bold text-slate-900 hover:text-indigo-600 transition"
                                    >
                                      {cleanName}
                                    </a>
                                  ) : (
                                    <span className="text-xs font-bold text-slate-900">{cleanName}</span>
                                  )}
                                  {cleanHandle && cleanHandle !== cleanName && (
                                    <span className="text-[11px] text-slate-500 font-mono">{cleanHandle}</span>
                                  )}
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                                    {getPlatformIcon(l.platform, "w-2.5 h-2.5")}
                                    <span>{PLATFORM_LABEL[l.platform] ?? l.platform}</span>
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">
                                  Liked at: {fmtExactDateTime(l.likedAt)}
                                </span>
                              </div>
                            </div>
                            <span className="text-xs text-rose-500 font-bold">❤️ Reacted</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-8 rounded-xl border border-slate-200 bg-slate-50/50 text-center space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Total Likes: {totals.likesCount}</p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Likes and reactions are synced live from connected channels.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 flex items-center gap-2">
            <span>Data stored in PostgreSQL</span>
            <span>&bull;</span>
            <span>Real-time platform sync</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 shadow-2xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
