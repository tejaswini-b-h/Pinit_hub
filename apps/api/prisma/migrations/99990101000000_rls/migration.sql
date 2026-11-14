-- RLS on every table, no policies: anon/authenticated roles get nothing.
-- The API and worker connect with the server (service) role, which bypasses RLS.
ALTER TABLE social_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media            ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_targets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_attempts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_buckets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_publish_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
