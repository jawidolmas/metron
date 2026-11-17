const { url, anonKey, schema } = window.METRON_CONFIG;
window.sb = window.supabase.createClient(url, anonKey, {
  db: { schema },
  auth: { persistSession: true, autoRefreshToken: true }
});
