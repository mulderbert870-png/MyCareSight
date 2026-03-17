import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared Supabase client type for the query layer.
 * Use this as the first parameter in all query functions so the same query
 * can be run with browser, server, or admin client.
 */
export type Supabase = SupabaseClient
