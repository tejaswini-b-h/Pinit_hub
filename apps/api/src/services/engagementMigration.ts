import { prisma } from '../db';

let migrated = false;

/**
 * Ensures the engagement tracking tables (user_profiles, post_likes, post_comments, post_shares)
 * and relations exist in the database. Runs once on startup.
 */
export async function ensureEngagementTables(): Promise<void> {
  if (migrated) return;
  try {
    // 1. user_profiles
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "user_profiles" (
        "id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "display_name" TEXT NOT NULL,
        "avatar_url" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
      );
    `);

    // Backfill any existing owners from posts and social_accounts
    await prisma.$executeRawUnsafe(`
      INSERT INTO "user_profiles" ("id", "email", "display_name")
      SELECT DISTINCT owner_id, owner_id || '@local.user', 'User ' || SUBSTRING(owner_id, 1, 8)
      FROM "posts"
      ON CONFLICT ("id") DO NOTHING;
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "user_profiles" ("id", "email", "display_name")
      SELECT DISTINCT owner_id, owner_id || '@local.user', 'User ' || SUBSTRING(owner_id, 1, 8)
      FROM "social_accounts"
      ON CONFLICT ("id") DO NOTHING;
    `);

    // 2. post_likes
    await prisma.$executeRawUnsafe(`
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
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_likes_post_id_idx" ON "post_likes"("post_id");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_likes_user_id_idx" ON "post_likes"("user_id");`);

    // 3. post_comments
    await prisma.$executeRawUnsafe(`
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
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_comments_post_id_idx" ON "post_comments"("post_id");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_comments_user_id_idx" ON "post_comments"("user_id");`);

    // 4. post_shares
    await prisma.$executeRawUnsafe(`
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
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_shares_post_id_idx" ON "post_shares"("post_id");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_shares_shared_by_user_id_idx" ON "post_shares"("shared_by_user_id");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "post_shares_shared_to_user_id_idx" ON "post_shares"("shared_to_user_id");`);

    // 5. posts.owner_id foreign key
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'posts_owner_id_fkey'
        ) THEN
          ALTER TABLE "posts" ADD CONSTRAINT "posts_owner_id_fkey"
          FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // 6. social_media_engagements
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "social_media_engagements" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "target_id" UUID NOT NULL,
        "post_id" UUID NOT NULL,
        "platform" TEXT NOT NULL,
        "likes_count" INTEGER NOT NULL DEFAULT 0,
        "comments_count" INTEGER NOT NULL DEFAULT 0,
        "shares_count" INTEGER NOT NULL DEFAULT 0,
        "views_count" INTEGER NOT NULL DEFAULT 0,
        "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "social_media_engagements_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "social_media_engagements_target_id_key" UNIQUE ("target_id"),
        CONSTRAINT "social_media_engagements_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "social_media_engagements_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "social_media_engagements_post_id_idx" ON "social_media_engagements"("post_id");`);

    // 7. social_media_comments
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "social_media_comments" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "engagement_id" UUID NOT NULL,
        "external_id" TEXT,
        "platform" TEXT NOT NULL,
        "author_name" TEXT NOT NULL,
        "author_handle" TEXT,
        "author_avatar_url" TEXT,
        "author_profile_url" TEXT,
        "content" TEXT NOT NULL,
        "like_count" INTEGER NOT NULL DEFAULT 0,
        "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "social_media_comments_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "social_media_comments_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "social_media_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "social_media_comments_engagement_id_idx" ON "social_media_comments"("engagement_id");`);

    // 8. social_media_likes
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "social_media_likes" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "engagement_id" UUID NOT NULL,
        "external_id" TEXT,
        "platform" TEXT NOT NULL,
        "author_name" TEXT NOT NULL,
        "author_handle" TEXT,
        "author_avatar_url" TEXT,
        "author_profile_url" TEXT,
        "liked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "social_media_likes_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "social_media_likes_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "social_media_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "social_media_likes_engagement_id_idx" ON "social_media_likes"("engagement_id");`);

    // 9. social_media_shares
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "social_media_shares" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "engagement_id" UUID NOT NULL,
        "external_id" TEXT,
        "platform" TEXT NOT NULL,
        "author_name" TEXT NOT NULL,
        "author_handle" TEXT,
        "author_avatar_url" TEXT,
        "author_profile_url" TEXT,
        "note" TEXT,
        "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "social_media_shares_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "social_media_shares_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "social_media_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "social_media_shares_engagement_id_idx" ON "social_media_shares"("engagement_id");`);

    // 10. RLS
    await prisma.$executeRawUnsafe(`ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "post_likes" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "post_comments" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "post_shares" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "social_media_engagements" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "social_media_comments" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "social_media_likes" ENABLE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "social_media_shares" ENABLE ROW LEVEL SECURITY;`);

    // Clean up any legacy synthetic placeholder rows that may have been created earlier
    await prisma.$executeRawUnsafe(`
      DELETE FROM "social_media_comments" 
      WHERE "author_name" LIKE '%Viewer #%' 
         OR "author_name" LIKE '%User #%' 
         OR "author_name" LIKE '%Follower #%' 
         OR "author_name" LIKE '%Member #%'
         OR "author_name" = 'Instagram User'
         OR "author_name" = 'YouTube Viewer'
         OR "author_name" = 'Facebook User'
         OR "author_name" = 'LinkedIn Member';
    `);
    await prisma.$executeRawUnsafe(`
      DELETE FROM "social_media_likes" 
      WHERE "author_name" LIKE '%Viewer #%' 
         OR "author_name" LIKE '%User #%' 
         OR "author_name" LIKE '%Follower #%' 
         OR "author_name" LIKE '%Connection #%'
         OR "author_name" = 'Instagram User'
         OR "author_name" = 'YouTube Viewer'
         OR "author_name" = 'Facebook User'
         OR "author_name" = 'LinkedIn Member'
         OR "author_name" = 'LinkedIn Connection';
    `);
    await prisma.$executeRawUnsafe(`
      DELETE FROM "social_media_shares" 
      WHERE "author_name" LIKE '%Viewer #%' 
         OR "author_name" LIKE '%User #%' 
         OR "author_name" LIKE '%Member #%'
         OR "author_name" = 'Instagram User'
         OR "author_name" = 'Facebook User'
         OR "author_name" = 'LinkedIn Member';
    `);

    migrated = true;
    console.log(JSON.stringify({ msg: 'engagement tables verified' }));
  } catch (e: any) {
    console.warn(JSON.stringify({ msg: 'ensureEngagementTables warning', error: e?.message }));
  }
}

