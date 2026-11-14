# PinITHUB Publish

Write once, publish protected content to many platforms, exactly once.
React + Vite web app, Node/Express API, a separate Node worker, Supabase (Postgres queue + Storage).
Docs: `docs/ARCHITECTURE.md`, `docs/openapi.yaml` (API + PinITHUB bridge contract), `docs/PLATFORMS.md`, `docs/RESULTS.md`.

## 1. Create your own Supabase project (do not use the team database)
1. https://supabase.com > **New project** (nearby region, save the DB password).
2. **Project Settings > Database > Connection string**: copy the *Transaction pooler* URL (port 6543) and the *Session/direct* URL (port 5432).
3. **Project Settings > API**: copy the project URL, the **anon** key and the **service_role** key (server only, never in the web app, never in git).
4. **Storage > New bucket** named `media`, **private**.
5. **Authentication > Providers**: Email on. For testing, turn off "Confirm email".

## 2. Configure
```
npm install                                   # also runs `prisma generate`
cp apps/api/.env.example apps/api/.env        # fill in (comments inside)
cp apps/web/.env.example apps/web/.env        # VITE_* values; anon key only
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # paste as TOKEN_ENCRYPTION_KEY
```

## 3. Create the tables
```
cd apps/api
npx prisma migrate deploy      # applies 20261026000000_init (tables) then 99990101000000_rls (row-level security)
```
After this, Supabase > Table editor should show 9 tables, each with "RLS enabled".

## 4. Run everything (5 terminals)
```
npm run dev    --workspace api      # API on :4000
npm run worker --workspace api      # publisher worker
npm run mock   --workspace api      # mock platform on :4200 (all failure modes)
npm run bridge --workspace api      # mock PinITHUB asset bridge on :4100
npm run dev    --workspace web      # web app on :5173
```
Sign up in the web app, find your user id in Supabase > Authentication > Users, then add a demo account that needs no real platform:
`npm run seed:mock --workspace api -- <your-user-id>`.
Break it on purpose: `curl -X POST localhost:4200/mode -H 'content-type: application/json' -d '{"mode":"429"}'` (modes: ok, 429, 401, 400, 403, 500, timeout, timeout_after_send, already_posted, expired_once).

## 5. Tests
The database tests create and delete rows and **refuse to run unless `DATABASE_URL` points to localhost** (use a local Postgres or Docker `postgres:16`, run `npx prisma migrate deploy` against it; never your Supabase project).
```
npm test --workspace api            # 104 unit tests, no database
npm run test:api   --workspace api  # 40 tests against a local database: isolation, every error class, reconcile, security
npm run test:chaos --workspace api  # kills workers at random during 100 publishes; 30 scheduled posts across 10 time zones
npm test --workspace web            # time-zone and daylight-saving tests
bash scripts/security-scan.sh       # secrets, server keys in the bundle, dependency audit
npm run load-test --workspace api   # create-post latency, 20 users (API started with NODE_ENV=test RATE_LIMIT_PER_MIN=1000000)
npm run publish-n --workspace api -- <accountId> 50 30 --yes   # success rate on a REAL test account (really posts)
```
Results are written up in `docs/RESULTS.md`.

## 6. Connect real platforms (own test accounts only)
- **LinkedIn**: https://developer.linkedin.com > Create app (needs a Company Page). Products: *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect*. Redirect URL `http://localhost:4000/v1/publish/accounts/linkedin/callback`. Set `LINKEDIN_VERSION` to a version the docs list as current.
- **Facebook Page**: https://developers.facebook.com > Create app (development mode), Facebook Login, redirect URL `http://localhost:4000/v1/publish/accounts/facebook/callback`. Add yourself as admin/tester; you need a Page you manage. Meta's console wording changes; follow its current docs. Set `GRAPH_VERSION`.
- **Bluesky**: Settings > App Passwords; connect in the Accounts page with handle + app password.
- **Telegram**: bot from @BotFather, a channel you own, the bot added as admin; connect with bot token + `@channel`.
- **X**: skipped (paid API). Add later with `src/adapters/x.ts` + one line in `adapters/registry.ts`.

## Deploy (plan: Vercel + Render + Supabase, same region)
Web: Vercel, build `npm run build --workspace web`, env `VITE_*`. API: Render web service, build `npm install && npx prisma generate`, start `npm run start:api` (or `npx tsx src/index.ts` from `apps/api`). Worker: Render background worker, start `npx tsx src/worker/index.ts`. Set every `.env.example` variable on both Render services; set `API_URL` to the Render URL and `APP_URL` to the Vercel URL, and add the matching redirect URLs in the LinkedIn and Meta apps.

## Layout
```
apps/api/src/adapters   one file per platform (same interface), registry.ts
apps/api/src/worker     engine.ts (claim, retry, reconcile), bridge.ts, tokens.ts, index.ts
apps/api/src/services   crypto, oauth, storage, validation, posts, buckets, asset bridge
apps/api/src/routes     all /v1/publish endpoints
apps/api/tools          mock platform + mock PinITHUB bridge
apps/api/tests          unit, api (database), chaos
apps/web/src            Accounts, Compose, Calendar, Posts (dashboard), Assets
```

## AI use note
(Write this yourself and make it true. Say which tools you used, for which files, what you reviewed, changed or rewrote, and what you can explain without help: the claim query, reconcile, idempotency, and the no-lookup decision are the ones you will be asked about.)
