/** Supabase values never contain spaces or line breaks, but copy-paste into .env often adds one. Clean them. */
export const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, '').replace(/^["']+|["']+$/g, '');
export const supabaseUrl = () => clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
export const supabaseAnonKey = () => clean(process.env.SUPABASE_ANON_KEY);
export const supabaseServiceKey = () => clean(process.env.SUPABASE_SERVICE_ROLE_KEY);