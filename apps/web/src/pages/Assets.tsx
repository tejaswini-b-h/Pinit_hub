import { useCallback, useEffect, useState } from 'react';
import { api, useLive, Asset, HistoryRow, PLATFORM_LABEL } from '../api';
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
  BlueskyIcon,
  TelegramIcon
} from '../components/Icons';

export default function Assets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [hist, setHist] = useState<Record<string, HistoryRow[]>>({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const a = await api<Asset[]>('/assets');
      setAssets(a);
      const h = await Promise.all(a.map(x => api<HistoryRow[]>(`/assets/${x.id}/history`)));
      setHist(Object.fromEntries(a.map((x, i) => [x.id, h[i]])));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useLive(load);

  const getPlatformIcon = (platform: string, className = "w-3.5 h-3.5") => {
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
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Protected Asset Bridge</h2>
        <p className="text-sm text-slate-500 mt-1">Audit and track where each watermarked or protected digital asset has been published.</p>
      </div>

      {err && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-900">
          {err} (Is the asset bridge service active?)
        </div>
      )}

      {assets.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-3 shadow-xs">
          <p className="text-sm font-semibold text-slate-700">No assets imported</p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Protected assets created in PinITHUB will automatically sync here through the asset bridge.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {assets.map(a => {
            const publications = hist[a.id] ?? [];
            return (
              <div key={a.id} className="bg-white border border-slate-200/80 rounded-2xl p-4 flex gap-4 shadow-xs hover:border-slate-300 transition">
                <img src={a.url} className="h-28 w-32 object-cover rounded-xl border border-slate-100 shrink-0" alt="" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-xs text-slate-900 truncate">{a.name}</p>
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                      {publications.length} {publications.length === 1 ? 'Publish' : 'Publishes'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Broadcast History</p>
                    {publications.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">Not published yet</p>
                    ) : (
                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {publications.map((h, i) => (
                          <div key={i} className="text-xs flex items-center justify-between text-slate-600 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                            <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                              {getPlatformIcon(h.platform)}
                              <span>{PLATFORM_LABEL[h.platform] ?? h.platform}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400">
                                {new Date(h.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                              <a
                                className="text-indigo-600 hover:underline font-semibold text-[11px]"
                                href={h.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View &rarr;
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
