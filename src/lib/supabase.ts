import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

// Service role client — used server-side only, has full DB access
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Anon client — used for public/limited operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
