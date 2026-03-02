import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Cliente Supabase (browser). Se as envs não existirem, vira null para não quebrar build.
 */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
