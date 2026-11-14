import 'dotenv/config';
import { createApp } from './app';
import { ensureEngagementTables } from './services/engagementMigration';

// Say clearly at startup what is missing (names only, never values).
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'TOKEN_ENCRYPTION_KEY', 'APP_URL', 'API_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) console.warn(JSON.stringify({ msg: 'MISSING environment variables in apps/api/.env', missing }));
try { if (process.env.SUPABASE_URL) new URL(process.env.SUPABASE_URL); } catch { console.warn(JSON.stringify({ msg: 'SUPABASE_URL is not a valid URL; it must look like https://<project-ref>.supabase.co' })); }
if ((process.env.SUPABASE_URL ?? '').match(/\/(rest|auth)\/v1|\/$/)) console.warn(JSON.stringify({ msg: 'SUPABASE_URL must have no trailing slash and no /rest/v1 or /auth/v1 part' }));
for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
  if (/\s/.test((process.env[k] ?? '').trim())) console.warn(JSON.stringify({ msg: `${k} contains a space or line break inside the value; it is cleaned automatically, but fix apps/api/.env so it is one clean line` }));

const port = Number(process.env.PORT ?? 4000);

(async () => {
  await ensureEngagementTables();
  createApp().listen(port, () => console.log(JSON.stringify({ msg: 'api listening', port })));
})();