import { useCallback, useEffect, useState } from 'react';
import { api, Account, PLATFORM_LABEL } from '../api';
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
  BlueskyIcon,
  TelegramIcon
} from '../components/Icons';

export default function Accounts() {
  const [list, setList] = useState<Account[]>([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState<'bluesky' | 'telegram' | null>(null);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Account[]>('/accounts').then(setList).catch(e => setErr(e.message)), []);
  
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    if (q.get('error')) setErr(q.get('error')!);
    if (q.get('connected')) {
      // Clear URL parameter cleanly
      history.replaceState(null, '', '#accounts');
    }
  }, [load]);

  const connect = async (p: 'linkedin' | 'facebook' | 'instagram' | 'youtube') => {
    setErr('');
    try {
      location.href = (await api<{ url: string }>(`/accounts/${p}/connect`)).url;
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const save = async () => {
    if (!a.trim() || !b.trim()) return;
    setBusy(true);
    try {
      await api('/accounts/credentials', { method: 'POST', json: { platform: form, a, b } });
      setForm(null);
      setA('');
      setB('');
      setErr('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const days = (x: string | null) => (x ? Math.ceil((Date.parse(x) - Date.now()) / 86400_000) : null);

  const platformBadge = (platform: string) => {
    switch (platform) {
      case 'linkedin':
        return <span className="p-2 rounded-xl bg-blue-50 text-[#0A66C2]"><LinkedInIcon className="w-5 h-5" /></span>;
      case 'facebook_page':
        return <span className="p-2 rounded-xl bg-blue-50 text-[#1877F2]"><FacebookIcon className="w-5 h-5" /></span>;
      case 'instagram':
        return <span className="p-2 rounded-xl bg-pink-50 text-[#E4405F]"><InstagramIcon className="w-5 h-5" /></span>;
      case 'youtube':
        return <span className="p-2 rounded-xl bg-red-50 text-[#FF0000]"><YouTubeIcon className="w-5 h-5" /></span>;
      case 'bluesky':
        return <span className="p-2 rounded-xl bg-sky-50 text-[#0285FF]"><BlueskyIcon className="w-5 h-5" /></span>;
      case 'telegram':
        return <span className="p-2 rounded-xl bg-sky-50 text-[#229ED9]"><TelegramIcon className="w-5 h-5" /></span>;
      default:
        return <span className="p-2 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs uppercase">{platform.slice(0, 2)}</span>;
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Social Integrations</h2>
          <p className="text-sm text-slate-500 mt-1">Connect, monitor, and manage your social channels with secure OAuth tokens.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/60 w-fit">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>{list.filter(x => x.status === 'CONNECTED').length} Active Channels</span>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-3 shadow-xs">
          <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="font-semibold">Notice</p>
            <p className="text-xs text-red-700 mt-0.5">{err}</p>
          </div>
          <button onClick={() => setErr('')} className="text-xs text-red-500 hover:text-red-700 font-bold">✕</button>
        </div>
      )}

      {/* Connect New Platforms Grid */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Available Platforms</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          
          {/* LinkedIn Button */}
          <button
            onClick={() => connect('linkedin')}
            className="group p-3.5 rounded-xl border border-slate-200 hover:border-[#0A66C2]/40 bg-white hover:bg-blue-50/30 flex flex-col items-center gap-2 text-center shadow-xs transition cursor-pointer"
          >
            <span className="p-2.5 rounded-xl bg-blue-50 text-[#0A66C2] group-hover:scale-105 transition">
              <LinkedInIcon className="w-6 h-6" />
            </span>
            <span className="text-xs font-semibold text-slate-800 group-hover:text-[#0A66C2] transition">LinkedIn</span>
            <span className="text-[10px] text-slate-400">Profile / Pages</span>
          </button>

          {/* Facebook Button */}
          <button
            onClick={() => connect('facebook')}
            className="group p-3.5 rounded-xl border border-slate-200 hover:border-[#1877F2]/40 bg-white hover:bg-blue-50/30 flex flex-col items-center gap-2 text-center shadow-xs transition cursor-pointer"
          >
            <span className="p-2.5 rounded-xl bg-blue-50 text-[#1877F2] group-hover:scale-105 transition">
              <FacebookIcon className="w-6 h-6" />
            </span>
            <span className="text-xs font-semibold text-slate-800 group-hover:text-[#1877F2] transition">Facebook</span>
            <span className="text-[10px] text-slate-400">Pages & Feed</span>
          </button>

          {/* Instagram Button */}
          <button
            onClick={() => connect('instagram')}
            className="group p-3.5 rounded-xl border border-slate-200 hover:border-[#E4405F]/40 bg-white hover:bg-pink-50/30 flex flex-col items-center gap-2 text-center shadow-xs transition cursor-pointer"
          >
            <span className="p-2.5 rounded-xl bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white group-hover:scale-105 transition shadow-xs">
              <InstagramIcon className="w-6 h-6" />
            </span>
            <span className="text-xs font-semibold text-slate-800 group-hover:text-[#ee2a7b] transition">Instagram</span>
            <span className="text-[10px] text-slate-400">Professional Feed</span>
          </button>

          {/* YouTube Button */}
          <button
            onClick={() => connect('youtube')}
            className="group p-3.5 rounded-xl border border-slate-200 hover:border-[#FF0000]/40 bg-white hover:bg-red-50/30 flex flex-col items-center gap-2 text-center shadow-xs transition cursor-pointer"
          >
            <span className="p-2.5 rounded-xl bg-red-50 text-[#FF0000] group-hover:scale-105 transition">
              <YouTubeIcon className="w-6 h-6" />
            </span>
            <span className="text-xs font-semibold text-slate-800 group-hover:text-[#FF0000] transition">YouTube</span>
            <span className="text-[10px] text-slate-400">Channel Videos</span>
          </button>

          {/* Bluesky Button */}
          <button
            onClick={() => setForm('bluesky')}
            className={`group p-3.5 rounded-xl border ${form === 'bluesky' ? 'border-[#0285FF] ring-2 ring-[#0285FF]/20 bg-sky-50/40' : 'border-slate-200 hover:border-[#0285FF]/40 bg-white hover:bg-sky-50/30'} flex flex-col items-center gap-2 text-center shadow-xs transition cursor-pointer`}
          >
            <span className="p-2.5 rounded-xl bg-sky-50 text-[#0285FF] group-hover:scale-105 transition">
              <BlueskyIcon className="w-6 h-6" />
            </span>
            <span className="text-xs font-semibold text-slate-800 group-hover:text-[#0285FF] transition">Bluesky</span>
            <span className="text-[10px] text-slate-400">App Password</span>
          </button>

          {/* Telegram Button */}
          <button
            onClick={() => setForm('telegram')}
            className={`group p-3.5 rounded-xl border ${form === 'telegram' ? 'border-[#229ED9] ring-2 ring-[#229ED9]/20 bg-sky-50/40' : 'border-slate-200 hover:border-[#229ED9]/40 bg-white hover:bg-sky-50/30'} flex flex-col items-center gap-2 text-center shadow-xs transition cursor-pointer`}
          >
            <span className="p-2.5 rounded-xl bg-sky-50 text-[#229ED9] group-hover:scale-105 transition">
              <TelegramIcon className="w-6 h-6" />
            </span>
            <span className="text-xs font-semibold text-slate-800 group-hover:text-[#229ED9] transition">Telegram</span>
            <span className="text-[10px] text-slate-400">Bot Channel</span>
          </button>
        </div>
      </div>

      {/* Bluesky / Telegram Manual Form Card */}
      {form && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-lg space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 capitalize">Connect {form}</h4>
            <button onClick={() => setForm(null)} className="text-xs text-slate-400 hover:text-slate-600 font-bold">Cancel</button>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            {form === 'bluesky'
              ? 'Enter your Bluesky handle and an App Password (generated in Bluesky Settings > App Passwords). Never enter your master password.'
              : 'Enter your Telegram Bot Token (from @BotFather) and your public Channel username (e.g. @mychannel). Make sure to add the bot as an administrator first.'}
          </p>
          <div className="space-y-3">
            <input
              className="border border-slate-300 rounded-lg w-full px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              placeholder={form === 'bluesky' ? 'handle.bsky.social' : 'Bot Token (123456:ABC...)'}
              value={a}
              onChange={e => setA(e.target.value)}
            />
            <input
              className="border border-slate-300 rounded-lg w-full px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              type={form === 'bluesky' ? 'password' : 'text'}
              placeholder={form === 'bluesky' ? 'App password (xxxx-xxxx-xxxx-xxxx)' : '@channel_username'}
              value={b}
              onChange={e => setB(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              onClick={() => setForm(null)}
              className="px-4 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={save}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Authorize Channel'}
            </button>
          </div>
        </div>
      )}

      {/* Connected Accounts List */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Channel Connections</h3>

        {list.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-800">No accounts connected yet</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Click one of the platform buttons above to link your social accounts. Once connected, you can publish cross-platform in one click.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200/80 rounded-2xl divide-y divide-slate-100 shadow-xs overflow-hidden">
            {list.map(x => (
              <div key={x.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition">
                <div className="flex items-center gap-3.5">
                  {platformBadge(x.platform)}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900">{x.displayName}</span>
                      <span className="text-[11px] font-semibold text-slate-400">({PLATFORM_LABEL[x.platform] ?? x.platform})</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        x.status === 'CONNECTED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                          : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${x.status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                        <span>{x.status === 'CONNECTED' ? 'Active & Ready' : 'Needs Reconnection'}</span>
                      </span>

                      {days(x.expiresAt) !== null && x.status === 'CONNECTED' && (
                        <span className="text-[11px] text-slate-400 font-medium">
                          &bull; Token valid for {days(x.expiresAt)} days
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 self-end sm:self-center">
                  {x.status === 'NEEDS_RECONNECT' && ['linkedin', 'facebook_page', 'instagram', 'youtube'].includes(x.platform) && (
                    <button
                      onClick={() => connect(x.platform === 'linkedin' ? 'linkedin' : (x.platform === 'instagram' ? 'instagram' : (x.platform === 'youtube' ? 'youtube' : 'facebook')))}
                      className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 text-xs font-semibold transition"
                    >
                      Reconnect
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (confirm(`Disconnect ${x.displayName}? Any scheduled or queued posts for this account will be cancelled.`)) {
                        await api(`/accounts/${x.id}`, { method: 'DELETE' });
                        load();
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 text-xs font-semibold transition"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

