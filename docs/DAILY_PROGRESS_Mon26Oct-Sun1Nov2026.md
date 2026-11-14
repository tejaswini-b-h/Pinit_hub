# PinITHUB Publish: daily progress and final status
**Name:** Tejaswini B Hugar  **Module:** Social publishing  **Period:** Mon 26 Oct to Sun 1 Nov 2026  (supersedes the Mon to Thu report)

**Legend.** VERIFIED = run, with the evidence named (all on a local Postgres + mock platform, see docs/RESULTS.md). BUILT = code written and type-checked, not yet run end to end. PENDING = needs my Supabase project, developer apps or real accounts. Tick the last column only after you have run it yourself and attached a screenshot or recording.

> Honest summary: the build started on Tuesday, so Monday's items were completed late, together with the rest of the week. The core (queue, retries, reconcile, scheduling, security) is verified against a real database with the mock platform. Real LinkedIn/Facebook/Bluesky/Telegram publishing, Supabase-hosted storage and sign-in, and the recorded demo are still to do.

## Day by day
| Day | Phase | What was delivered | Evidence | I ran it |
|---|---|---|---|---|
| **Mon 26** | 0 + 1 | Plan reading and API study on the day; the build items below were completed on Tue. Repo + CI, 9-table schema, RLS migration, owner checks, adapter interface, mock platform with 10 failure modes | VERIFIED: schema validated and applied to Postgres 16; adapter and mock tests; isolation suite | ☐ |
| **Tue 27** | 2 | OAuth connect/callback (state, 10-min single use), AES-256-GCM tokens, refresh + Needs reconnect, Accounts page, Bluesky/Telegram credentials connect | VERIFIED: crypto + OAuth-state tests (unknown, expired, wrong platform, replay); refresh and reconnect paths via mock. BUILT/PENDING: real LinkedIn and Facebook login | ☐ |
| **Wed 28** | 3 | Composer (counters, per-platform preview, overrides), validation from the same adapter rules, signed upload, protected-asset picker (mock bridge) | VERIFIED: 104 unit tests (every rule pass/fail, 5 adapters). BUILT/PENDING: Supabase upload, UI click-through | ☐ |
| **Thu 29** | 4 | Post + targets in one write with idempotency key; SKIP LOCKED claim; error classes; backoff; reconcile; per-account rate bucket; chaos test | VERIFIED: chaos 4/4 runs = exactly 100 posts; control run with reconcile off = 114 posts; 28 engine tests | ☐ |
| **Fri 30** | 5 | Scheduling with time zone (UTC + IANA), claim loop as scheduler, calendar (month/week) with edit/cancel, dashboard tiles, live status (SSE + polling fallback), manual retry, edit-and-retry | VERIFIED: 30 posts / 10 zones start within 1.0 s; edit after publish = 409; cancel; stream delivers to owner only; 11 time-zone/DST tests. BUILT: calendar and dashboard screens (build passes, not click-tested) | ☐ |
| **Sat 31** | 6 + 7 | Asset events (exactly one per publish, delivered with retry, de-duplicated), asset history screen, best-time hint, per-platform caption override; security suite; measurements | VERIFIED: event + failed-delivery test; leak scan of logs, responses and every DB column; rate limit; secret scan; audit (1 accepted finding, documented); RESULTS.md | ☐ |
| **Sun 1 Nov** | 8 | README (own-Supabase setup), ARCHITECTURE.md, openapi.yaml (19 operations), PLATFORMS.md, RESULTS.md, CI with Postgres | VERIFIED: OpenAPI parses; docs reviewed. PENDING: recorded demo | ☐ |

## Test results (final run)
- API unit **104 passed**; API with database **40 passed**; chaos **100 / 100 posts (15 kills)**; schedule **30 / 30 on time (max +1.0 s)**; web **11 passed** + production build OK; security scan clean (1 accepted dependency finding).
- API speed (create post, 20 users): warm p95 **199 to 277 ms**, cold **336 to 342 ms** against a 300 ms target: re-measure on the deployed API.

## Section 17 acceptance checklist
| # | Item | Status |
|---|---|---|
| 1 | Publishes to LinkedIn, a Facebook Page and the mock platform, now and scheduled | Mock: done. **LinkedIn and Facebook: PENDING** (need your developer apps) |
| 2 | Zero duplicates in the chaos test | Done (RESULTS.md) |
| 3 | Every error class shows the right status, reason and action | Done in tests; show it in the demo |
| 4 | Protected asset published and visible in its publish list | Done through the mock bridge (test + screen); show in the demo |
| 5 | Tokens encrypted, never exposed; cross-account tests pass | Done |
| 6 | Measurements recorded with test size | Done for the mock platform; **real-account rows PENDING** |
| 7 | Contract in OpenAPI | Done (`docs/openapi.yaml`) |
| 8 | Setup under one hour; AI-use note | **PENDING:** a reviewer must time the README; **you must write the AI-use note** |

## What I still have to do (in this order)
1. Create my Supabase project and run the README steps; confirm 9 tables with RLS and the private `media` bucket.
2. Create the LinkedIn and Meta developer apps; do the first real publish (now and scheduled) with test accounts; screenshot; fix whatever the real APIs reveal.
3. Run `publish-n` (50 posts) on each real test account; run the load test against the deployed API; paste into RESULTS.md.
4. Deploy (Vercel + Render); record the demo: connect, compose, publish now, schedule, force a failure, retry, asset history.
5. Write the AI-use note in the README.

## Doubts for the team
1. Please share the prototype as a PDF or screenshots (the link could not be opened for me).
2. LinkedIn cannot look up a sent post, so after a timeout I mark the target Failed instead of retrying (no duplicate possible; one manual step). Acceptable?
3. LinkedIn and Meta API versions change; who confirms the versions to use (`LINKEDIN_VERSION`, `GRAPH_VERSION`)?
4. PinITHUB's side of the asset bridge must make `POST /assets/{id}/events` idempotent on `targetId`. Can you confirm?

## AI-use note
(Replace with your own words: tools used, which files, what you changed, what you can explain.)
