import { Request, Response, NextFunction } from 'express';
import { supabaseUrl, supabaseAnonKey } from './env';
import { prisma } from './db';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

const cache = new Map<string, { user: AuthUser; exp: number }>();

async function syncUserProfile(user: AuthUser) {
  try {
    await prisma.userProfile.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      update: {
        email: user.email,
        displayName: user.displayName,
        ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      },
    });
  } catch (err: any) {
    // Non-blocking: database sync should not fail authentication
    console.warn(JSON.stringify({ msg: 'syncUserProfile warning', error: err?.message }));
  }
}

/** Verifies the Supabase access token and sets res.locals.userId and res.locals.user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (process.env.NODE_ENV === 'test' && req.header('x-test-user')) {
      const testUid = req.header('x-test-user')!;
      const testUser: AuthUser = { id: testUid, email: `${testUid}@example.com`, displayName: testUid };
      res.locals.userId = testUid;
      res.locals.user = testUser;
      syncUserProfile(testUser);
      return next();
    }
    if (!supabaseUrl() || !supabaseAnonKey()) {
      console.error(JSON.stringify({ msg: 'auth config missing', missing: [['SUPABASE_URL', supabaseUrl()], ['SUPABASE_ANON_KEY', supabaseAnonKey()]].filter(([, v]) => !v).map(([k]) => k) }));
      return res.status(503).json({ error: 'The API is missing SUPABASE_URL or SUPABASE_ANON_KEY in apps/api/.env. Fill them in and restart the API.' });
    }
    const h = req.header('authorization') ?? '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in required' });
    const hit = cache.get(h);
    if (hit && hit.exp > Date.now()) {
      res.locals.userId = hit.user.id;
      res.locals.user = hit.user;
      return next();
    }
    const r = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { authorization: h, apikey: supabaseAnonKey() }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(401).json({ error: 'Sign in required' });
    const u: any = await r.json();
    const displayName = u.user_metadata?.full_name || u.user_metadata?.name || u.user_metadata?.displayName || (u.email ? u.email.split('@')[0] : 'User');
    const user: AuthUser = {
      id: u.id,
      email: u.email ?? `${u.id}@user.local`,
      displayName: String(displayName),
      avatarUrl: u.user_metadata?.avatar_url,
    };
    cache.set(h, { user, exp: Date.now() + 60_000 });
    res.locals.userId = user.id;
    res.locals.user = user;
    syncUserProfile(user);
    next();
  } catch (e) {
    // The sign-in check could not reach Supabase. Say so, instead of a vague 500.
    console.error(JSON.stringify({ msg: 'auth check failed', error: (e as Error).message, cause: (e as any)?.cause?.code ?? (e as any)?.cause?.message ?? null }));
    return res.status(503).json({ error: 'The API could not reach Supabase to check your sign-in. Check SUPABASE_URL (https://<project-ref>.supabase.co) and your network, then restart the API.' });
  }
}
export const uid = (res: Response): string => res.locals.userId;
export const currentUser = (res: Response): AuthUser => res.locals.user ?? { id: res.locals.userId, email: '', displayName: 'User' };
