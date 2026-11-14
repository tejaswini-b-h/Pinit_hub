import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma talks to Postgres through the pg driver (no Rust engine). Supabase pooler flags are Prisma-only, so strip them.
function connectionString(): string {
  const u = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/postgres');
  u.searchParams.delete('pgbouncer'); u.searchParams.delete('connection_limit');
  return u.toString();
}
const adapter = new PrismaPg({ connectionString: connectionString(), max: Number(process.env.DB_POOL ?? 5) });
export const prisma = new PrismaClient({ adapter });
