/**
 * Centralized query layer. All database queries should go through this module.
 * Callers create the appropriate Supabase client (browser, server, or admin)
 * and pass it as the first argument to each query function.
 */
export * from './query/index'
