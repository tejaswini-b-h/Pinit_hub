import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, supabase, Account, Asset, Rules, PLATFORM_LABEL } from '../api';
import { zonedToUtc, utcToZonedLocal } from '../tz';
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
  BlueskyIcon,
  TelegramIcon
} from '../components/Icons';

interface Img { path: string; preview: string; name: string }
const ZONES: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : ['UTC'];
const newKey = () => crypto.randomUUID();

export default function Compose() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Record<string, Rules>>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [imgs, setImgs] = useState<Img[]>([]);
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [local, setLocal] = useState('');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<string>('');
  const key = useRef(newKey());

  useEffect(() => {
    api<Account[]>('/accounts').then(a => {
      setAccounts(a);
      // Auto-select all connected accounts by default
      setSelected(a.filter(x => x.status === 'CONNECTED').map(x => x.id));
    }).catch(e => setMsg({ type: 'err', text: e.message }));
    api<{ id: string; rules: Rules }[]>('/platforms').then(p => setRules(Object.fromEntries(p.map(x => [x.id, x.rules]))));
    api<Asset[]>('/assets').then(setAssets).catch(() => setAssets([]));
  }, []);

  const chosen = useMemo(() => accounts.filter(a => selected.includes(a.id)), [accounts, selected]);
  const draft = useMemo(() => ({
    body,
    accountIds: selected,
    overrides: Object.fromEntries(Object.entries(overrides).filter(([id, v]) => v && selected.includes(id))),
    mediaPaths: imgs.map(i => i.path),
    assetId: asset?.id
  }), [body, selected, overrides, imgs, asset]);

  // live validation (debounced)
  useEffect(() => {
    if (!selected.length) { setProblems({}); return; }
    const t = setTimeout(() => {
      api<{ problems: Record<string, string[]> }>('/validate', { method: 'POST', json: draft })
        .then(r => setProblems(r.problems))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [draft, selected.length]);

  useEffect(() => {
    if (!chosen.find(c => c.id === tab)) setTab(chosen[0]?.id ?? '');
  }, [chosen, tab]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMsg(null);
    for (const f of Array.from(files)) {
      try {
        const ext = f.name.toLowerCase().split('.').pop() || '';
        const mime = f.type || (ext === 'png' ? 'image/png' : (ext === 'mp4' ? 'video/mp4' : (ext === 'webm' ? 'video/webm' : (ext === 'gif' ? 'image/gif' : 'image/jpeg'))));
        const slot = await api<{ path: string; token: string }>('/media/upload-url', { method: 'POST', json: { mime, bytes: f.size } });
        const { error } = await supabase.storage.from('media').uploadToSignedUrl(slot.path, slot.token, f, { contentType: mime });
        if (error) throw error;
        setImgs(x => [...x, { path: slot.path, preview: URL.createObjectURL(f), name: f.name }]);
      } catch (e) {
        setMsg({ type: 'err', text: `Could not upload ${f.name}: ${(e as Error).message}` });
      }
    }
  };

  const hasInstagram = chosen.some(c => c.platform === 'instagram');
  const hasYoutube = chosen.some(c => c.platform === 'youtube');
  const hasVideo = imgs.some(i => i.name.toLowerCase().endsWith('.mp4') || i.name.toLowerCase().endsWith('.webm'));

  const blockers: string[] = [
    ...(selected.length === 0 ? ['Select at least one social channel to publish to.'] : []),
    ...(body.trim().length + imgs.length + (asset ? 1 : 0) === 0 ? ['Enter caption text or attach a media file.'] : []),
    ...(hasInstagram && imgs.length === 0 && !asset ? ['Instagram requires at least one image or video.'] : []),
    ...(hasYoutube && !hasVideo ? ['YouTube requires an .mp4 or .webm video file.'] : []),
    ...(when === 'later' && !local ? ['Select a date and time for scheduled delivery.'] : []),
    ...Object.values(problems).flat(),
  ];

  const submit = async () => {
    if (blockers.length) {
      setMsg({ type: 'err', text: blockers[0] });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const scheduledAt = when === 'later' ? zonedToUtc(local, tz).toISOString() : undefined;
      const r = await api<{ postId: string; targets: unknown[] }>('/posts', {
        method: 'POST',
        key: key.current,
        json: { ...draft, scheduledAt, timezone: when === 'later' ? tz : undefined }
      });
      setMsg({
        type: 'ok',
        text: `Post queued successfully! ${r.targets.length} platform target(s) are scheduled. Check the Queue & History tab.`
      });
      key.current = newKey();
      setBody('');
      setImgs([]);
      setAsset(null);
      setOverrides({});
    } catch (e) {
      if (e instanceof ApiError && e.body?.problems) setProblems(e.body.problems);
      else setMsg({ type: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Best-time recommendation
  const [hint, setHint] = useState<{ hourUtc: number; successRate: number; samples: number } | null>(null);
  const firstPlatform = chosen[0]?.platform;
  useEffect(() => {
    if (!firstPlatform) { setHint(null); return; }
    api<{ suggestion: typeof hint }>(`/best-time?platform=${firstPlatform}`).then(r => setHint(r.suggestion)).catch(() => setHint(null));
  }, [firstPlatform]);

  const useHint = () => {
    if (!hint) return;
    const d = new Date();
    d.setUTCHours(hint.hourUtc, 0, 0, 0);
    if (d.getTime() < Date.now() + 60_000) d.setUTCDate(d.getUTCDate() + 1);
    setWhen('later');
    setLocal(utcToZonedLocal(d, tz));
  };

  const cur = chosen.find(c => c.id === tab);
  const curRules = cur ? rules[cur.platform] : undefined;
  const curText = cur ? overrides[cur.id] || body : '';
  const nImages = imgs.length + (asset ? 1 : 0);

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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Create Post</h2>
        <p className="text-sm text-slate-500 mt-1">Compose once, preview live, and broadcast across all your connected social channels.</p>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl text-xs font-semibold flex items-center justify-between border ${
          msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
        }`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Post Editor */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-6">
          
          {/* Target Platforms */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Publish Targets</label>
              <button
                type="button"
                onClick={() => {
                  if (selected.length === accounts.filter(a => a.status === 'CONNECTED').length) setSelected([]);
                  else setSelected(accounts.filter(a => a.status === 'CONNECTED').map(a => a.id));
                }}
                className="text-xs text-indigo-600 font-semibold hover:underline"
              >
                {selected.length === accounts.filter(a => a.status === 'CONNECTED').length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            {accounts.length === 0 ? (
              <p className="text-xs text-slate-400 bg-slate-50 p-3 rounded-lg border border-slate-200/60">
                No accounts connected yet. Go to <a href="#accounts" className="text-indigo-600 font-bold underline">Connected Accounts</a> to link your channels.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {accounts.map(a => {
                  const isChecked = selected.includes(a.id);
                  const isReady = a.status === 'CONNECTED';
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border text-xs cursor-pointer transition select-none ${
                        !isReady
                          ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-200'
                          : isChecked
                          ? 'border-indigo-600 bg-indigo-50/40 text-slate-900 shadow-2xs font-semibold'
                          : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!isReady}
                        checked={isChecked}
                        onChange={e => setSelected(s => e.target.checked ? [...s, a.id] : s.filter(x => x !== a.id))}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      {getPlatformIcon(a.platform)}
                      <span className="truncate flex-1">{a.displayName}</span>
                      {!isReady && <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Reconnect</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Caption Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Post Caption</label>
              <span className="text-xs text-slate-400 font-medium">Supports emojis & links</span>
            </div>
            <textarea
              className="w-full border border-slate-200 rounded-xl p-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition min-h-[140px] resize-y"
              placeholder="What would you like to share today? Write your message once to publish everywhere..."
              value={body}
              onChange={e => setBody(e.target.value)}
            />

            {/* Character Limit Indicators */}
            {chosen.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {chosen.map(c => {
                  const r = rules[c.platform];
                  const textLen = Array.from(overrides[c.id] || body).length;
                  const isOver = r && textLen > r.maxChars;
                  return (
                    <span
                      key={c.id}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                        isOver
                          ? 'bg-red-50 text-red-700 border-red-200 font-semibold'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {getPlatformIcon(c.platform, "w-3 h-3")}
                      <span>{PLATFORM_LABEL[c.platform]}: {textLen}/{r?.maxChars ?? '—'}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Media Uploads */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Media Attachments</label>
              <span className="text-xs text-slate-400">Photos (JPEG, PNG) &bull; Videos (MP4, WebM)</span>
            </div>

            <label className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition bg-slate-50/50 hover:bg-indigo-50/20 group">
              <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-indigo-600 group-hover:border-indigo-300 transition shadow-xs mb-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-slate-700">Click to upload images or videos</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Up to 100 MB per file &bull; Direct cloud upload</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,video/mp4,video/webm"
                multiple
                className="hidden"
                onChange={e => upload(e.target.files)}
              />
            </label>

            {/* Thumbnail Preview Grid */}
            {imgs.length > 0 && (
              <div className="flex gap-2.5 flex-wrap pt-1">
                {imgs.map(i => {
                  const isVideo = i.name.toLowerCase().endsWith('.mp4') || i.name.toLowerCase().endsWith('.webm');
                  return (
                    <div key={i.path} className="relative group rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                      {isVideo ? (
                        <div className="w-20 h-20 bg-slate-900 flex items-center justify-center relative">
                          <video src={i.preview} className="w-full h-full object-cover" />
                          <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] font-bold px-1 rounded uppercase">Video</span>
                        </div>
                      ) : (
                        <div className="w-20 h-20 bg-slate-100 relative">
                          <img src={i.preview} className="w-full h-full object-cover" alt="" />
                          <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] font-bold px-1 rounded uppercase">Image</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setImgs(x => x.filter(y => y.path !== i.path))}
                        className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Protected Assets from PinITHUB Bridge */}
          {assets.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Protected Asset from Bridge</label>
              <div className="flex gap-2.5 overflow-x-auto py-1">
                {assets.map(a => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => setAsset(asset?.id === a.id ? null : a)}
                    className={`shrink-0 p-1.5 rounded-xl border text-left w-28 transition ${
                      asset?.id === a.id
                        ? 'border-indigo-600 ring-2 ring-indigo-500/20 bg-indigo-50/30'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <img src={a.url} className="h-16 w-full object-cover rounded-lg" alt="" />
                    <span className="text-[11px] font-medium text-slate-800 block truncate mt-1">{a.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scheduling Options */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Publish Timing</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWhen('now')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                  when === 'now'
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 shadow-2xs'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>🚀 Publish Immediately</span>
              </button>
              <button
                type="button"
                onClick={() => setWhen('later')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                  when === 'later'
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 shadow-2xs'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>📅 Schedule for Later</span>
              </button>
            </div>

            {/* Smart Schedule Hint */}
            {hint && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">💡</span>
                  <span>
                    Optimal time on {PLATFORM_LABEL[firstPlatform!]}: <b>{String(hint.hourUtc).padStart(2, '0')}:00 UTC</b> ({Math.round(hint.successRate * 100)}% engagement)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={useHint}
                  className="font-bold text-indigo-600 hover:underline shrink-0"
                >
                  Apply
                </button>
              </div>
            )}

            {/* DateTime Input when scheduling */}
            {when === 'later' && (
              <div className="grid sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Pick Date & Time</label>
                  <input
                    type="datetime-local"
                    className="border border-slate-300 rounded-lg w-full p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                    value={local}
                    onChange={e => setLocal(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Timezone</label>
                  <select
                    className="border border-slate-300 rounded-lg w-full p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                    value={tz}
                    onChange={e => setTz(e.target.value)}
                  >
                    {ZONES.map(z => <option key={z}>{z}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="button"
              disabled={busy || blockers.length > 0}
              onClick={submit}
              className={`w-full py-3 px-4 rounded-xl text-sm font-semibold text-white shadow-md transition flex items-center justify-center gap-2 ${
                blockers.length > 0
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-indigo-500/25'
              }`}
            >
              {busy ? (
                <span>Publishing in progress...</span>
              ) : when === 'now' ? (
                <span>Publish Now &rarr;</span>
              ) : (
                <span>Schedule Post &rarr;</span>
              )}
            </button>
            {blockers.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-2 text-center font-medium">
                {blockers[0]}
              </p>
            )}
          </div>

        </div>

        {/* Right Column: Live Omnichannel Social Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Live Platform Preview</h3>
            {chosen.length > 0 && (
              <span className="text-[11px] font-medium text-slate-400">Previewing: {PLATFORM_LABEL[cur?.platform ?? '']}</span>
            )}
          </div>

          {chosen.length === 0 ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-10 text-center text-slate-400 text-xs">
              Select one or more channels on the left to see how your post will render.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Channel Selector Pills */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {chosen.map(c => {
                  const active = tab === c.id;
                  const hasErr = !!problems[c.id];
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setTab(c.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
                        active
                          ? 'bg-white text-indigo-600 border-indigo-600 shadow-xs'
                          : 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200/60'
                      }`}
                    >
                      {getPlatformIcon(c.platform, "w-3.5 h-3.5")}
                      <span>{PLATFORM_LABEL[c.platform]}</span>
                      {hasErr && <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>}
                    </button>
                  );
                })}
              </div>

              {/* Feed Card Simulation */}
              {cur && curRules && (
                <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
                  {/* Mock Social Header */}
                  <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-slate-700">
                      {cur.displayName[0]?.toUpperCase() ?? 'U'}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{cur.displayName}</span>
                        {getPlatformIcon(cur.platform, "w-3 h-3")}
                      </div>
                      <span className="text-[10px] text-slate-400">Just now &bull; {PLATFORM_LABEL[cur.platform]}</span>
                    </div>
                  </div>

                  {/* Mock Content */}
                  <div className="p-4 space-y-3">
                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {curText || <span className="text-slate-300 italic">Your caption will appear here...</span>}
                    </p>

                    {/* Media Display */}
                    {(imgs.length > 0 || asset) && (
                      <div className={`rounded-xl overflow-hidden border border-slate-100 ${nImages > 1 ? 'grid grid-cols-2 gap-1' : ''}`}>
                        {imgs.map(i => {
                          const isVideo = i.name.toLowerCase().endsWith('.mp4') || i.name.toLowerCase().endsWith('.webm');
                          return isVideo ? (
                            <video key={i.path} src={i.preview} controls className="w-full max-h-60 object-cover bg-black" />
                          ) : (
                            <img key={i.path} src={i.preview} className="w-full max-h-60 object-cover" alt="" />
                          );
                        })}
                        {asset && <img src={asset.url} className="w-full max-h-60 object-cover" alt="" />}
                      </div>
                    )}
                  </div>

                  {/* Platform-Specific Caption Override */}
                  <div className="p-4 bg-slate-50/70 border-t border-slate-100 space-y-2">
                    <details className="group">
                      <summary className="text-[11px] font-semibold text-slate-600 hover:text-indigo-600 cursor-pointer select-none flex items-center justify-between">
                        <span>Tailor caption specifically for {PLATFORM_LABEL[cur.platform]}</span>
                        <span className="group-open:rotate-180 transition text-slate-400">&darr;</span>
                      </summary>
                      <textarea
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none mt-2 bg-white"
                        placeholder={`Custom text only for ${PLATFORM_LABEL[cur.platform]}...`}
                        value={overrides[cur.id] ?? ''}
                        onChange={e => setOverrides(o => ({ ...o, [cur.id]: e.target.value }))}
                      />
                    </details>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
