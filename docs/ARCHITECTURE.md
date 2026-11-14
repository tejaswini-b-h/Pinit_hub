# Architecture

```
Browser (React, Vercel) --Bearer--> API (Express, Render) --> Postgres (Supabase)  <-- Worker (Node, Render) --> Platform APIs
        |                               |                          ^   queue = post_targets (SKIP LOCKED)
        +--- signed upload ---> Supabase Storage (private bucket)   |
                                        +--> asset bridge (PinITHUB) <--- publish events (worker delivers, retries)
```
**The API never calls a platform inside a user request.** It validates, saves the post and one target per platform in one transaction and returns. The worker publishes.

## One post, end to end
1. **Compose**: text, images, or a protected asset; live previews; `/validate` runs the same adapter rules the worker uses.
2. **Create** (`POST /posts`, `Idempotency-Key` required): owner check, validation, then post + media + targets in one write. A repeat of the same key returns the same post.
3. **Claim** (`worker/engine.ts`): one `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` marks a due target `PUBLISHING` and records the worker. Two workers can never hold the same target. Scheduled posts are the same rows with `next_attempt_at` = the time, so the claim loop also is the scheduler (polling every second; measured start within about 1 s of the time).
4. **Rate bucket** (`services/buckets.ts`): a per-account token bucket in Postgres. If empty the target waits (Retrying); it is not dropped and does not use up an attempt.
5. **Publish** through the platform adapter. On a retry (`attempt_count > 1`) the worker first calls `findExisting` ("reconcile") so a post the platform accepted but never confirmed is adopted instead of repeated.
6. **Result** in one transaction: `PUBLISHED` + external id and link + attempt record + (if an asset is attached) exactly one `asset_publish_events` row (unique on target) + audit row. Only the worker that still holds the lock can finish a target.
7. **Deliver** (`worker/bridge.ts`): undelivered asset events are sent to PinITHUB every 10 s until a 2xx; the receiver de-duplicates by `targetId`.
8. **Live status**: `/events` (server-sent events) pushes changed targets; the web app falls back to polling every 5 s.

## Failure handling
| Class | Meaning | Worker does | User sees |
|---|---|---|---|
| RETRYABLE | timeout, 5xx, 429 | backoff 1/5/15/60 min with jitter (honours Retry-After), stop after 5 | Retrying (n/5) + next time |
| AUTH | 401, revoked token | one refresh; if impossible mark account Needs reconnect | Reconnect button, one-click Retry |
| VALIDATION | 400 | stop, keep the platform message | reason + Edit and retry |
| BLOCKED | cap, permission | no retry now, re-queue in 1 h is available via Retry | reason |

**No-lookup platforms (LinkedIn, Telegram):** after a timeout or 5xx the worker cannot know whether the post exists, so it does not retry automatically; it marks the target Failed with "it may already have been posted, check, then Retry". This trades one manual step in rare cases for a hard no-duplicate guarantee.

## Security
OAuth `state` random, single use, 10-minute expiry, bound to the platform; PKCE helper present (not used by LinkedIn/Meta web apps). Tokens: AES-256-GCM, decrypted only inside the worker (or refresh), never logged or returned, blanked on disconnect. RLS on every table with no policies (only the server role reads). Every route filters by the signed-in owner; the test login header works only when `NODE_ENV=test`. Request rate limit on the API. Media: private bucket, signed URLs valid for minutes, image type read from the bytes.

## Adding a platform
Implement `PlatformAdapter` (`validate`, `publish`, `findExisting`, `classify`, optional `refresh`), add rate-bucket defaults, register in `adapters/registry.ts`. X needs only keys plus `x.ts`.

## Known limits
See docs/PLATFORMS.md (no-lookup platforms, LinkedIn refresh tokens, Bluesky images, Telegram single image) and docs/RESULTS.md (what was measured where).
