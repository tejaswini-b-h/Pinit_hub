# Platforms

Limits and API details were looked up on 27 Oct 2026 from public documentation and third-party guides. **Re-check each against the official docs and write the date you did.**

| Platform | Auth | Status | Limits in adapter | Reconcile (find existing post) |
|---|---|---|---|---|
| Mock | none | tested (smoke) | 280 chars, 4 images | yes |
| LinkedIn | OAuth 2.0 (`openid profile w_member_social`) | code written and unit-tested; **not run against LinkedIn** | 3000 chars, 9 images | **no** (see gaps) |
| Facebook Page | OAuth, Page token via `/me/accounts` | code written, not run against Meta | 60000 chars, 10 images | yes (recent Page posts, same text, last 24 h) |
| Bluesky | handle + app password | code written, not run | 300 chars, 4 images (text only for now) | yes (deterministic record key) |
| Telegram | bot token + channel | code written, not run | 4096 chars / 1024 with photo | **no** |
| Instagram, Threads | Meta OAuth | not started (if time allows) | | |
| X | OAuth 2.0 PKCE | skipped (paid API); plug in via adapter | | |

Version settings: `LINKEDIN_VERSION` (YYYYMM, e.g. 202609) and `GRAPH_VERSION` (e.g. v26.0). Both must be checked against current docs; LinkedIn rejects expired versions.

## Known gaps (state these honestly in RESULTS.md)
- **LinkedIn and Telegram cannot look up a sent post.** If a request times out or returns 5xx after the platform may have accepted it, the target is marked **Failed** with the message "it may already have been posted, check the platform, then press Retry". It is *not* retried automatically, so no duplicate can happen. Definite answers (429, 4xx) still retry automatically.
- LinkedIn refresh tokens are only issued to some apps; otherwise the account becomes "Needs reconnect" when the 60-day token expires.
- Bluesky images are not uploaded yet (text posts only).
- Telegram posts one image per message.
- Facebook reconcile matches on identical text, so an intentional identical repost within 24 h could be mistaken for a retry.
- LinkedIn/Facebook use the client secret, not PKCE (PKCE is implemented in `services/pkce.ts` and switches on per provider with `pkce: true`).

## Trying the engine with no real account (mock platform)
`npm run seed:mock --workspace api -- <your-supabase-user-id>` adds a "Mock platform" account. Run `npm run mock --workspace api`, then switch behaviour live: `curl -X POST localhost:4200/mode -H 'content-type: application/json' -d '{"mode":"429"}'` (modes: ok, 429, 401, 400, 403, 500, timeout, timeout_after_send, already_posted, expired_once).
