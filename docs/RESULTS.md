# RESULTS

**Where these were measured.** Development machine (Linux, Node 22), **local PostgreSQL 16**, **mock platform**, API/worker/load generator on the same small machine. They have **not** yet been measured on Supabase, Render or real LinkedIn/Facebook accounts. Rows marked PENDING need your own runs; do not report them as done until you have them. Date: 31 Oct 2026.

## Summary
| # | Measurement (plan section 13) | Target | Result | Status |
|---|---|---|---|---|
| 1 | Duplicates under failure | 0 extra posts in 100 publishes with random worker kills | **0 extra** in 4 of 4 runs (100 posts for 100 targets each; 12 to 15 workers killed per run; 8 to 11 targets recovered after a kill per run). **Control run with reconcile switched off produced 114 posts (14 duplicates)**, so the test can see duplicates. | Met (mock) |
| 2 | Publish success, healthy platform | 100% of 50 publishes per connected account | Mock: **50/50 = 100%** (`publish-n`). LinkedIn, Facebook, Bluesky, Telegram: not run | Mock met, **real PENDING** |
| 3 | Schedule accuracy | every post starts within 60 s | 30 posts, 10 time zones, 2 runs: latest start **+1.0 s** after the scheduled time (median 0.4 s); none early; 30/30 published, 30 platform posts | Met (mock) |
| 4 | Failure reporting | every forced error shows the right status and reason | 429, 401 (no refresh), 401 + refresh ok, 401 + refresh fails, 400, 403, 500, timeout, timeout-after-send, 5 failures: all pass | Met (mock) |
| 5 | Validation | every rule has a passing and a failing test | 5 adapters x 12 rule tests, plus Telegram caption rule: pass | Met |
| 6 | API speed | create post p95 under 300 ms, 20 users | warm runs **199 to 277 ms** (6 runs); first, cold run **336 to 342 ms** (2 runs missed). Pool 5 vs pool 20 made no difference, so the limit here is the shared machine | Met when warm; **re-measure on Render + Supabase** |
| 7 | Isolation | user A never reads or publishes user B's data | Cross-account suite passes (read, cancel, retry, post with another user's account, history, stats, event stream) | Met |

Note on row 3: "earliest" is the smallest (start minus scheduled time) in ms; a positive value means no post started before its time.

## 1. Duplicates (chaos test)
`npm run test:chaos`: 100 targets, 3 workers, random SIGKILL of a worker every 0.7 to 1.5 s (stuck-job recovery set to 3 s for the test), mock platform adds up to 400 ms latency so kills land mid-publish. The mock does **not** de-duplicate; every request makes a new post.

| Run | Targets | Posts on platform | Published | Workers killed | Targets recovered after a kill |
|---|---|---|---|---|---|
| 1 | 100 | 100 | 100 | 13 | 8 |
| 2 | 100 | 100 | 100 | 14 | 11 |
| 3 | 100 | 100 | 100 | 12 | 8 |
| 4 (final code) | 100 | 100 | 100 | 15 | 10 |
| **Control: reconcile OFF** | 100 | **114** | 100 | 19 | 11 |

What stops duplicates: unique idempotency key per target, atomic claim (`SKIP LOCKED`), reconcile (`findExisting`) before any retry, and only the lock holder may mark a target Published.

## 2. Publish success
Mock platform, 50 posts, worker running: 50 published, platform count 50. **PENDING:** run `npm run publish-n --workspace api -- <accountId> 50 30 --yes` for each real test account and paste the JSON line here.

## 3. Schedule accuracy
`tests/chaos/schedule.test.ts`: 30 posts spread over 40 s, labelled with 10 time zones (Kolkata, UTC, New York, London, Sydney, Tokyo, Los Angeles, Berlin, Auckland, Sao Paulo), one worker at the default 1 s polling.

| Run | Earliest | Median | p95 | Latest (ms after scheduled time) | Published | Platform posts |
|---|---|---|---|---|---|---|
| 1 | +46 | 466 | 958 | 962 | 30 | 30 |
| 2 (final code) | +27 | 385 | 985 | 1014 | 30 | 30 |

Time-zone conversion and daylight saving (US clocks change on 1 Nov 2026): 11 tests incl. New York before and after the change, Kolkata, London, Sydney, Auckland and round trips. Edit after publishing is refused with 409 (tested).

## 4. Failure reporting
| Forced error | Status | Reason shown | Action |
|---|---|---|---|
| 429 (+ Retry-After) | Retrying | "rate limit" | automatic retry at the next time |
| 401, no refresh | Needs reconnect (account flagged) | "Reconnect this account" | Reconnect, then Retry |
| 401, refresh works | Retrying then Published | n/a | token replaced automatically |
| 401, refresh fails | Needs reconnect | | |
| 400 | Failed | platform message | Edit and retry |
| 403 | Blocked | "daily limit or not allowed" | retry later |
| 500 / timeout | Retrying | "server error / no response" | automatic |
| 5 failures in a row | Failed | last reason | manual Retry |
| timeout after the platform saved the post | Retrying, then Published **without a second post** | | reconcile |
| platform rate bucket empty | Retrying, no attempt used | "waiting for rate limit" | automatic |

## 5. API speed (create post, 20 concurrent users, 1000 requests per run)
| Run | p50 | p95 | p99 | max |
|---|---|---|---|---|
| before collapsing writes (cold, warm) | 216 / 179 | 336 / 245 | 576 / 315 | |
| after: cold, warm, warm | 185 / 162 / 150 | 342 / 227 / 200 | 582 / 265 / 237 | 704 / 303 / 314 |
| pool 5: 3 warm runs | 172 / 157 / 154 | 247 / 199 / 206 | | |
| pool 20: 3 warm runs | 177 / 155 / 157 | 277 / 220 / 219 | | |
No platform is called inside the request. **PENDING:** repeat against the deployed API and Supabase (network latency will add to these numbers; if it misses 300 ms, the next step is fewer queries per request or a closer region).

## 6. Security checks
| Check | Result |
|---|---|
| Token never in logs, any API response, or any text column of any table (sentinel scan of every table) | Pass |
| Tokens stored as AES-256-GCM (`iv.tag.cipher`); tamper detected | Pass |
| OAuth state: unknown, expired, wrong-platform and replayed state all refused | Pass |
| Test-login header ignored outside `NODE_ENV=test` | Pass |
| Request rate limit returns 429 | Pass |
| Validation errors do not leak internals | Pass |
| Disconnect blanks the stored token and cancels queued posts | Pass |
| Secret scan, `.env` ignored, server keys absent from the web bundle (`scripts/security-scan.sh`) | Pass |
| Dependency audit (production): one accepted finding | **Accepted risk:** `prisma` CLI chain (deepmerge-ts, GHSA-ggr8-5vv4-36mx) in Prisma's config loader, which never receives user input; fix is Prisma 7 (breaking). Zod was upgraded to 4.6.7 to clear its advisory. Next step: migrate to Prisma 7 |
| RLS enabled on all 9 tables (migration `99990101000000_rls`) | Applied locally; **PENDING:** confirm in Supabase (Table editor shows "RLS enabled") |

## 7. Test inventory
API unit: 104 (crypto, all adapters' rules and error classes, image sniffing, PKCE, backoff, best-time). API with database: 40 (isolation 7, engine 28, security 5 groups incl. leak scan). Chaos 1, schedule 1. Web: 11 (time zones). Web production build and TypeScript check pass.

## Not done / not measured (be explicit in the demo)
- Real LinkedIn, Facebook Page, Bluesky, Telegram publishes (code written; needs your developer apps and accounts). Real LinkedIn/Meta API behaviour may need small fixes.
- Instagram, Threads (optional extras), X (skipped by agreement).
- Browser screens were built and type-checked but not click-tested here; no Playwright end-to-end suite.
- Supabase Storage upload and signed-URL paths and Supabase sign-in were not exercised (no Supabase project here).
- Repost tracking (plan "next step").
