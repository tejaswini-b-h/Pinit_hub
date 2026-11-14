import { useCallback, useEffect, useState } from 'react';
import { api, useLive, PostRow, Target, PLATFORM_LABEL } from '../api';
import EngagementModal from '../components/EngagementModal';
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
  BlueskyIcon,
  TelegramIcon
} from '../components/Icons';

export const CHIP: Record<string, { label: string; badge: string; dot: string }> = {
  SCHEDULED: { label: 'Scheduled', badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  QUEUED: { label: 'Queued', badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  PUBLISHING: { label: 'Publishing', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse', dot: 'bg-indigo-500' },
  PUBLISHED: { label: 'Published', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  RETRYING: { label: 'Retrying', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  NEEDS_RECONNECT: { label: 'Reconnect', badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  FAILED: { label: 'Failed', badge: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  BLOCKED: { label: 'Blocked', badge: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

const fmt = (s: string) => new Date(s).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

type Stats = Record<string, number>;

export default function Posts() {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [days, setDays] = useState(7);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [activeModalPost, setActiveModalPost] = useState<PostRow | null>(null);
  const [modalTab, setModalTab] = useState<'overview' | 'comments' | 'likes'>('overview');
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PostRow[]>('/posts').then(setPosts).catch(e => setErr(e.message));
    api<Stats>(`/stats?days=${days}`).then(setStats).catch(() => {});
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useLive(load);
  
  useEffect(() => {
    if (open) api(`/posts/${open}`).then(setDetail).catch(() => {});
    else setDetail(null);
  }, [open, posts]);

  const retry = async (t: Target, text?: string) => {
    try {
      await api(`/targets/${t.id}/retry`, { method: 'POST', json: text ? { text } : {} });
      setErr('');
      load();
    } catch (e: any) {
      setErr(e.body?.problems ? Object.values(e.body.problems).flat().join(' ') : e.message);
    }
  };

  const cancel = async (id: string) => {
    if (confirm('Cancel all pending platforms for this post?')) {
      await api(`/posts/${id}`, { method: 'DELETE' });
      load();
    }
  };

  const syncSocialEngagement = async (p: PostRow) => {
    setSyncingId(p.id);
    try {
      const res = await api(`/posts/${p.id}/sync-social-engagement`, { method: 'POST' });
      setPosts(prev => prev.map(item => item.id === p.id ? {
        ...item,
        likesCount: res.totals?.likesCount ?? item.likesCount,
        commentsCount: res.totals?.commentsCount ?? item.commentsCount,
        sharesCount: res.totals?.sharesCount ?? item.sharesCount,
        viewsCount: res.totals?.viewsCount ?? item.viewsCount,
        lastSyncedAt: res.lastSyncedAt ?? item.lastSyncedAt,
        byPlatform: res.byPlatform ?? item.byPlatform,
      } : item));
    } catch (e: any) {
      setErr(e.message || 'Failed to sync engagement from social platforms.');
    } finally {
      setSyncingId(null);
    }
  };

  const openEngagement = (p: PostRow, tab: 'overview' | 'comments' | 'likes' = 'overview') => {
    setActiveModalPost(p);
    setModalTab(tab);
  };

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

  return (
    <div className="space-y-8">
      {/* Dashboard Top Header & KPIs */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Queue & History</h2>
            <p className="text-sm text-slate-500 mt-1">Real-time status tracking, audit timelines, and error diagnosis across all channels.</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500">Timeframe:</span>
            <select
              className="border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
              value={days}
              onChange={e => setDays(Number(e.target.value))}
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Published</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{stats['PUBLISHED'] ?? 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              ✓
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scheduled</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{stats['SCHEDULED'] ?? 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              📅
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Retrying</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{stats['RETRYING'] ?? 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              ↻
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Failed / Blocked</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{(stats['FAILED'] ?? 0) + (stats['BLOCKED'] ?? 0)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
              !
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between">
          <span>{err}</span>
          <button onClick={() => setErr('')} className="font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Posts List */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recent Posts Activity</h3>

        {posts.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-3 shadow-xs">
            <p className="text-sm font-semibold text-slate-700">No posts in this period</p>
            <p className="text-xs text-slate-400">Head over to the Compose tab to create and publish your first post.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map(p => (
              <div key={p.id} className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden transition hover:border-slate-300">
                
                {/* Post Card Header */}
                <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-relaxed">
                      {p.body || <span className="text-slate-400 italic">(Media upload only)</span>}
                    </p>
                    <span className="text-[11px] text-slate-400 font-medium block mt-1">
                      {p.scheduledAt ? `Scheduled for: ${fmt(p.scheduledAt)}` : `Created: ${fmt(p.createdAt)}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white text-xs font-semibold text-slate-600 transition shadow-2xs"
                    >
                      {open === p.id ? 'Hide Details' : 'View Details'}
                    </button>
                    <button
                      onClick={() => cancel(p.id)}
                      className="px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 hover:bg-red-50 text-xs font-semibold text-red-600 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {/* Platform Target Rows */}
                <div className="p-4 sm:p-5 divide-y divide-slate-100">
                  {p.targets.map(t => {
                    const chip = CHIP[t.status] ?? { label: t.status, badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
                    return (
                      <div key={t.id} className="py-3 first:pt-0 last:pb-0 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          
                          {/* Channel & Status */}
                          <div className="flex items-center gap-3">
                            <span className="p-1.5 rounded-lg bg-slate-50 border border-slate-200/80">
                              {getPlatformIcon(t.account.platform, "w-4 h-4")}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900">{t.account.displayName}</span>
                                <span className="text-[11px] text-slate-400">({PLATFORM_LABEL[t.account.platform] ?? t.account.platform})</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${chip.badge}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${chip.dot}`}></span>
                                  <span>{chip.label}{t.status === 'RETRYING' && t.attemptCount > 0 ? ` (Try ${t.attemptCount}/5)` : ''}</span>
                                </span>

                                {t.status === 'RETRYING' && (
                                  <span className="text-[11px] text-amber-700 font-medium">
                                    Next attempt at {fmt(t.nextAttemptAt)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Link / Error / Action */}
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            {t.externalUrl && (
                              <a
                                href={t.externalUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/70 px-2.5 py-1 rounded-lg transition"
                              >
                                <span>View live post</span>
                                <span className="text-[10px]">&nearr;</span>
                              </a>
                            )}

                            {t.lastError && t.status !== 'PUBLISHED' && (
                              <span className="text-xs text-rose-600 font-medium max-w-xs truncate" title={t.lastError}>
                                {t.lastError}
                              </span>
                            )}

                            {t.status === 'NEEDS_RECONNECT' && (
                              <a
                                href="#accounts"
                                className="text-xs font-semibold text-orange-600 hover:underline"
                              >
                                Reconnect Channel
                              </a>
                            )}

                            {['FAILED', 'BLOCKED', 'NEEDS_RECONNECT'].includes(t.status) && (
                              <button
                                onClick={() => retry(t)}
                                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-2xs transition"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Inline Caption Edit for Validation Failures */}
                        {t.status === 'FAILED' && t.lastErrorClass === 'VALIDATION' && (
                          <div className="flex items-center gap-2 pt-1">
                            <input
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 flex-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-50/60"
                              placeholder="Adjust text for this channel to fix character limit..."
                              value={edit[t.id] ?? ''}
                              onChange={e => setEdit(x => ({ ...x, [t.id]: e.target.value }))}
                            />
                            <button
                              onClick={() => retry(t, edit[t.id])}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-semibold shadow-xs transition"
                            >
                              Update & Retry
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Attached Media Preview */}
                {p.media && p.media.length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-900/5 p-4 flex gap-3 overflow-x-auto">
                    {p.media.map(m => (
                      <div key={m.id} className="relative rounded-xl overflow-hidden border border-slate-200 bg-black max-h-48 max-w-xs shrink-0 shadow-2xs">
                        {m.mime?.startsWith('video/') || m.storagePath?.endsWith('.mp4') || m.storagePath?.endsWith('.webm') ? (
                          <video src={m.url} controls className="max-h-48 w-auto object-contain" />
                        ) : (
                          <img src={m.url} alt="Attached media" className="max-h-48 w-auto object-contain" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Social Media Engagement Tracking Bar */}
                <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 text-xs">
                  <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Social Engagement:
                    </span>

                    {/* Likes */}
                    <button
                      onClick={() => openEngagement(p, 'likes')}
                      className="inline-flex items-center gap-1.5 font-bold text-slate-700 hover:text-rose-600 transition"
                      title="Click to view likes from social platforms"
                    >
                      <span className="text-rose-500">❤️</span>
                      <span>{p.likesCount ?? 0} {p.likesCount === 1 ? 'Like' : 'Likes'}</span>
                    </button>

                    {/* Comments */}
                    <button
                      onClick={() => openEngagement(p, 'comments')}
                      className="inline-flex items-center gap-1.5 font-bold text-slate-700 hover:text-indigo-600 transition"
                      title="Click to view comments from social platforms"
                    >
                      <span>💬</span>
                      <span>{p.commentsCount ?? 0} {p.commentsCount === 1 ? 'Comment' : 'Comments'}</span>
                    </button>

                    {/* Views (for video targets) */}
                    {(p.viewsCount !== undefined && p.viewsCount > 0) && (
                      <div className="inline-flex items-center gap-1.5 font-bold text-slate-600">
                        <span>👁️</span>
                        <span>{p.viewsCount} Views</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => syncSocialEngagement(p)}
                      disabled={syncingId === p.id}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 shadow-2xs transition inline-flex items-center gap-1 disabled:opacity-50"
                      title="Sync live likes, comments, and shares directly from YouTube, Facebook, Instagram, LinkedIn"
                    >
                      <span className={syncingId === p.id ? 'animate-spin' : ''}>🔄</span>
                      <span>{syncingId === p.id ? 'Syncing...' : 'Sync Live'}</span>
                    </button>

                    <button
                      onClick={() => openEngagement(p, 'overview')}
                      className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-[11px] font-bold text-indigo-700 shadow-2xs transition"
                    >
                      View Details &rarr;
                    </button>
                  </div>
                </div>

                {/* Collapsible Timeline / Audit Log */}
                {open === p.id && detail?.targets && (
                  <div className="bg-slate-50 border-t border-slate-100 p-4 sm:p-5 space-y-3">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                      <span>Attempt Audit Log</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                    </p>
                    <div className="space-y-2">
                      {detail.targets.flatMap((t: any) => t.attempts.map((a: any) => (
                        <div key={a.id} className="p-2.5 rounded-xl bg-white border border-slate-200/80 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1 shadow-2xs">
                          <div className="flex items-center gap-2">
                            {getPlatformIcon(t.account.platform, "w-3.5 h-3.5")}
                            <span className="font-semibold text-slate-800">{PLATFORM_LABEL[t.account.platform]}</span>
                            <span className="text-slate-400">&bull;</span>
                            <span className="text-slate-500">{fmt(a.startedAt)}</span>
                          </div>
                          <span className={`font-mono text-[11px] font-semibold ${
                            a.finishedAt && !a.errorClass ? 'text-emerald-600' : 'text-rose-600'
                          }`}>
                            {a.errorClass ? `${a.errorClass}: ${a.reason}` : a.finishedAt ? 'HTTP 200 OK' : 'Worker in progress...'}
                          </span>
                        </div>
                      )))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Engagement Detail Modal */}
      {activeModalPost && (
        <EngagementModal
          post={activeModalPost}
          initialTab={modalTab}
          onClose={() => setActiveModalPost(null)}
          onPostUpdated={updated => {
            setPosts(prev => prev.map(item => item.id === activeModalPost.id ? { ...item, ...updated } : item));
            setActiveModalPost(prev => prev ? { ...prev, ...updated } : null);
          }}
        />
      )}
    </div>
  );
}
