// Run from apps/api:  node check-env.js      Prints only set/MISSING and results, never your keys.
require('dotenv').config();
const need = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','TOKEN_ENCRYPTION_KEY','APP_URL','API_URL'];
(async () => {
  console.log('--- 1. variables in apps/api/.env');
  for (const k of need) console.log(' ', k.padEnd(28), process.env[k] ? 'set' : '** MISSING **');
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
    if (/\s/.test(process.env[k] || '')) console.log('  ** ' + k + ' contains a space or LINE BREAK inside the value. Open apps/api/.env, delete the line and retype it as ONE line: ' + k + '=value **');
  const clean = v => (v || '').replace(/\s+/g, '').replace(/^["']+|["']+$/g, '');
  const url = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
  if (/\/$/.test(url) || /\/(rest|auth)\/v1/.test(url)) console.log('  ** SUPABASE_URL must be only https://<project-ref>.supabase.co (no trailing / and no /rest/v1) **');
  if (process.env.TOKEN_ENCRYPTION_KEY && Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) console.log('  ** TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 (see README step 2) **');
  console.log('--- 2. can Node reach Supabase sign-in (the same call the API makes)? (tested with the value cleaned of spaces/line breaks)');
  try {
    const r = await fetch(url + '/auth/v1/health', { headers: { apikey: clean(process.env.SUPABASE_ANON_KEY) }, signal: AbortSignal.timeout(10000) });
    console.log('  HTTP', r.status, r.status === 200 ? '-> good' : '-> reachable but the key or URL is wrong (401/403 = wrong anon key; 404 = wrong URL)');
  } catch (e) { console.log('  FAILED:', e.message, '| cause:', (e.cause && (e.cause.code || e.cause.message)) || 'none'); }
  console.log('--- 3. can Node reach the database and are the tables there?');
  try {
    const { Client } = require('pg'); const u = new URL(process.env.DATABASE_URL);
    u.searchParams.delete('pgbouncer'); u.searchParams.delete('connection_limit');
    const c = new Client({ connectionString: u.toString(), connectionTimeoutMillis: 10000 }); await c.connect();
    const r = await c.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('posts','post_targets','social_accounts','post_media','publish_attempts','rate_buckets','asset_publish_events','oauth_states','audit_log')");
    await c.end(); console.log('  connected. Tables found:', r.rows[0].n, 'of 9', r.rows[0].n === 9 ? '-> good' : '-> create the tables (README step 3, or the SQL Editor)');
  } catch (e) { console.log('  FAILED:', e.code || e.message); }
})();