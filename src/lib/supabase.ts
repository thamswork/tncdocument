import { createClient } from '@supabase/supabase-js';

// In Cloudflare Workers, env vars from wrangler.toml [vars] are available via import.meta.env at build time
// but we need to handle runtime access too
const supabaseUrl = (globalThis as any).SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const supabaseServiceKey = (globalThis as any).SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = (globalThis as any).PUBLIC_SUPABASE_ANON_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY || '';

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
