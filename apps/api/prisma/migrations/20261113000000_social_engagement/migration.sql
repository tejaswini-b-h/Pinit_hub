-- Create user_profiles table
CREATE TABLE IF NOT EXISTS "user_profiles" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "avatar_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- Backfill any existing owners from posts and social_accounts
INSERT INTO "user_profiles" ("id", "email", "display_name")
SELECT DISTINCT owner_id, owner_id || '@local.user', 'User ' || SUBSTRING(owner_id, 1, 8)
FROM "posts"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "user_profiles" ("id", "email", "display_name")
SELECT DISTINCT owner_id, owner_id || '@local.user', 'User ' || SUBSTRING(owner_id, 1, 8)
FROM "social_accounts"
ON CONFLICT ("id") DO NOTHING;

-- Create post_likes table
CREATE TABLE IF NOT EXISTS "post_likes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "post_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_likes_post_id_user_id_key" UNIQUE ("post_id", "user_id"),
  CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "post_likes_post_id_idx" ON "post_likes"("post_id");
CREATE INDEX IF NOT EXISTS "post_likes_user_id_idx" ON "post_likes"("user_id");

-- Create post_comments table
CREATE TABLE IF NOT EXISTS "post_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "post_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "post_comments_post_id_idx" ON "post_comments"("post_id");
CREATE INDEX IF NOT EXISTS "post_comments_user_id_idx" ON "post_comments"("user_id");

-- Create post_shares table
CREATE TABLE IF NOT EXISTS "post_shares" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "post_id" UUID NOT NULL,
  "shared_by_user_id" TEXT NOT NULL,
  "shared_to_user_id" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_shares_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_shares_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_shares_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_shares_shared_to_user_id_fkey" FOREIGN KEY ("shared_to_user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "post_shares_post_id_idx" ON "post_shares"("post_id");
CREATE INDEX IF NOT EXISTS "post_shares_shared_by_user_id_idx" ON "post_shares"("shared_by_user_id");
CREATE INDEX IF NOT EXISTS "post_shares_shared_to_user_id_idx" ON "post_shares"("shared_to_user_id");

-- Add foreign key constraint from posts.owner_id to user_profiles.id if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_owner_id_fkey'
  ) THEN
    ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_shares" ENABLE ROW LEVEL SECURITY;

