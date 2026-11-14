import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './api';
import Accounts from './pages/Accounts';
import Compose from './pages/Compose';
import Posts from './pages/Posts';
import Calendar from './pages/Calendar';
import Assets from './pages/Assets';

const TABS = [
  { id: 'compose', label: 'Compose', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
  { id: 'calendar', label: 'Calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'posts', label: 'Queue & History', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'assets', label: 'Asset Bridge', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'accounts', label: 'Connected Accounts', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
] as const;

type Tab = (typeof TABS)[number]['id'];
const tabFromHash = (): Tab => {
  const h = location.hash.replace('#', '').split('?')[0] as Tab;
  return TABS.some(t => t.id === h) ? h : 'compose';
};

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    try {
      const { error } = mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) setMsg(error.message);
      else if (mode === 'up') setMsg('Account created! Please check your email to confirm, then sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="bg-white/95 backdrop-blur-md p-8 rounded-2xl shadow-2xl border border-white/20 w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-bold text-xl shadow-lg shadow-indigo-500/30">
            P
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">PinITHUB <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Publish</span></h1>
          <p className="text-sm text-slate-500">Omnichannel publishing engine with enterprise protection.</p>
        </div>

        <form onSubmit={go} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Email address</label>
            <input
              type="email"
              required
              className="border border-slate-300 rounded-lg w-full px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">Password</label>
            <input
              type="password"
              required
              className="border border-slate-300 rounded-lg w-full px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-medium rounded-lg py-2.5 shadow-md shadow-indigo-500/25 transition disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'in' ? 'Sign in to Dashboard' : 'Create Free Account'}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-100">
          <button
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(''); }}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition"
          >
            {mode === 'in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>

        {msg && (
          <div className="p-3 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200">
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(tabFromHash());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const h = () => setTab(tabFromHash());
    window.addEventListener('hashchange', h);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener('hashchange', h);
    };
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;

  const userEmail = session.user?.email || 'User';
  const userInitial = (userEmail[0] || 'U').toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-lg shadow-sm shadow-indigo-500/20">
              P
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-bold tracking-tight text-slate-900 leading-none">
                <span>PinITHUB</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                  Publish
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium block mt-0.5">Social Publishing Engine</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60">
            {TABS.map(t => {
              const active = tab === t.id;
              return (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                    active
                      ? 'bg-white text-indigo-600 shadow-xs border border-slate-200/60'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <svg className={`w-4 h-4 ${active ? 'text-indigo-600' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon} />
                  </svg>
                  <span>{t.label}</span>
                </a>
              );
            })}
          </nav>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-3">
            {/* Live SSE Pulse */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 rounded-full text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Live Engine</span>
            </div>

            {/* User Dropdown */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-900 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                {userInitial}
              </div>
              <div className="hidden lg:block text-left">
                <p className="text-xs font-semibold text-slate-800 leading-tight max-w-[120px] truncate">{userEmail}</p>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="text-[11px] text-slate-400 hover:text-red-600 transition block font-medium"
                >
                  Sign out
                </button>
              </div>
              <button
                onClick={() => supabase.auth.signOut()}
                className="lg:hidden p-1.5 text-slate-400 hover:text-red-600"
                title="Sign out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="md:hidden flex overflow-x-auto border-t border-slate-100 px-4 py-2 gap-1 bg-white">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <a
                key={t.id}
                href={`#${t.id}`}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                  active ? 'bg-indigo-50 text-indigo-600 font-semibold' : 'text-slate-600'
                }`}
              >
                <span>{t.label}</span>
              </a>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {tab === 'accounts' && <Accounts />}
        {tab === 'compose' && <Compose />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'posts' && <Posts />}
        {tab === 'assets' && <Assets />}
      </main>

      {/* Modern Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-auto text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>PinITHUB Publish &middot; Unified Multi-Platform Social Orchestration</span>
          <div className="flex items-center gap-4 text-slate-500">
            <span>LinkedIn</span>
            <span>&bull;</span>
            <span>Facebook</span>
            <span>&bull;</span>
            <span>Instagram</span>
            <span>&bull;</span>
            <span>YouTube</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

