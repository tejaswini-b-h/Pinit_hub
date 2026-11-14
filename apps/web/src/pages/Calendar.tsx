import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, useLive, PostRow, PLATFORM_LABEL } from '../api';
import { zonedToUtc, utcToZonedLocal } from '../tz';
import { CHIP } from './Posts';

const ZONES: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : ['UTC'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
};

export default function Calendar() {
  const [view, setView] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(new Date());
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [sel, setSel] = useState<PostRow | null>(null);
  const [text, setText] = useState('');
  const [local, setLocal] = useState('');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [msg, setMsg] = useState('');

  const days = useMemo(() => {
    const first = view === 'month' ? startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : startOfWeek(cursor);
    return Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      return d;
    });
  }, [view, cursor]);

  const load = useCallback(() => {
    const from = days[0].toISOString();
    const to = new Date(days[days.length - 1].getTime() + 86400_000).toISOString();
    api<PostRow[]>(`/posts?scheduledFrom=${encodeURIComponent(from)}&scheduledTo=${encodeURIComponent(to)}`)
      .then(setPosts)
      .catch(e => setMsg(e.message));
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useLive(load);

  const byDay = useMemo(() => {
    const m = new Map<string, PostRow[]>();
    for (const p of posts) {
      if (!p.scheduledAt) continue;
      const k = dayKey(new Date(p.scheduledAt));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);

  const pick = (p: PostRow) => {
    setSel(p);
    setText(p.body);
    const z = p.timezone ?? tz;
    setTz(z);
    setLocal(utcToZonedLocal(new Date(p.scheduledAt!), z));
    setMsg('');
  };

  const editable = !!sel && sel.targets.filter(t => t.status !== 'CANCELLED').every(t => t.status === 'SCHEDULED');
  const move = (n: number) => {
    const d = new Date(cursor);
    if (view === 'month') d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + 7 * n);
    setCursor(d);
  };

  const save = async () => {
    try {
      await api(`/posts/${sel!.id}`, {
        method: 'PATCH',
        json: { body: text, scheduledAt: zonedToUtc(local, tz).toISOString(), timezone: tz }
      });
      setMsg('Changes saved successfully.');
      setSel(null);
      load();
    } catch (e: any) {
      setMsg(e.status === 409 ? 'This post is already being published and cannot be modified.' : e.message);
      load();
    }
  };

  const cancel = async () => {
    if (confirm('Cancel this scheduled post?')) {
      await api(`/posts/${sel!.id}`, { method: 'DELETE' });
      setSel(null);
      load();
    }
  };

  return (
    <div className="space-y-6">
      {/* Calendar Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Content Calendar</h2>
          <p className="text-sm text-slate-500 mt-1">Visualize your upcoming schedule and drag or edit posts across channels.</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center border border-slate-200 bg-white rounded-xl p-1 shadow-2xs">
            <button
              onClick={() => move(-1)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              title="Previous"
            >
              &larr;
            </button>
            <span className="text-xs font-bold text-slate-800 px-3 w-36 text-center select-none">
              {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button
              onClick={() => move(1)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              title="Next"
            >
              &rarr;
            </button>
          </div>

          <button
            onClick={() => setCursor(new Date())}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition"
          >
            Today
          </button>

          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60">
            {(['month', 'week'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition ${
                  view === v ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {msg && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-800 font-medium">
          {msg}
        </div>
      )}

      {/* Calendar Grid */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        {/* Day Name Headers */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80 text-center text-xs font-bold text-slate-500 uppercase tracking-wider py-2.5">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d}>{d}</div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
          {days.map(d => {
            const isToday = dayKey(d) === dayKey(new Date());
            const isCurrentMonth = d.getMonth() === cursor.getMonth();
            const dayPosts = byDay.get(dayKey(d)) ?? [];

            return (
              <div
                key={d.toISOString()}
                className={`p-2 transition flex flex-col ${
                  view === 'month' ? 'min-h-[105px]' : 'min-h-[200px]'
                } ${!isCurrentMonth && view === 'month' ? 'bg-slate-50/50 opacity-40' : 'bg-white'}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                      isToday
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : isCurrentMonth
                        ? 'text-slate-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {dayPosts.length > 0 && (
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 rounded-full">
                      {dayPosts.length}
                    </span>
                  )}
                </div>

                <div className="space-y-1 flex-1 overflow-y-auto max-h-24">
                  {dayPosts
                    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
                    .map(p => {
                      const isSelected = sel?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => pick(p)}
                          className={`w-full text-left truncate rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-indigo-50/70 hover:bg-indigo-100/70 text-indigo-900 border border-indigo-100'
                          }`}
                        >
                          <span className="text-[10px] opacity-75 font-mono">
                            {new Date(p.scheduledAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="truncate flex-1">{p.body || '(Media)'}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Scheduled Post Editor Drawer/Card */}
      {sel && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 max-w-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900">Edit Scheduled Post</h4>
              <p className="text-xs text-slate-400">Modify content or reschedule time slot.</p>
            </div>
            <button
              onClick={() => setSel(null)}
              className="text-xs text-slate-400 hover:text-slate-600 font-bold p-1"
            >
              ✕
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {sel.targets.map(t => {
              const chip = CHIP[t.status] ?? { label: t.status, badge: 'bg-slate-100 text-slate-600' };
              return (
                <span
                  key={t.id}
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${chip.badge}`}
                >
                  {PLATFORM_LABEL[t.account.platform]}: {chip.label}
                </span>
              );
            })}
          </div>

          <textarea
            disabled={!editable}
            className="w-full border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none min-h-[90px] disabled:bg-slate-50"
            value={text}
            onChange={e => setText(e.target.value)}
          />

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Time Slot</label>
              <input
                disabled={!editable}
                type="datetime-local"
                className="border border-slate-300 rounded-lg p-2 text-xs w-full focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50"
                value={local}
                onChange={e => setLocal(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Timezone</label>
              <select
                disabled={!editable}
                className="border border-slate-300 rounded-lg p-2 text-xs w-full focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50"
                value={tz}
                onChange={e => setTz(e.target.value)}
              >
                {ZONES.map(z => <option key={z}>{z}</option>)}
              </select>
            </div>
          </div>

          {!editable && (
            <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
              This post has already started publishing and cannot be modified.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setSel(null)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              disabled={!editable}
              onClick={cancel}
              className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              Cancel Post
            </button>
            <button
              disabled={!editable}
              onClick={save}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs disabled:bg-slate-300"
            >
              Save Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
