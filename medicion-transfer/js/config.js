/*
 * config.js — Conexión con la base de datos en la nube (Supabase).
 *
 * Pega aquí los datos de tu proyecto Supabase (Settings → API / API Keys):
 *   supabaseUrl      → Project URL, por ejemplo https://abcdxyz.supabase.co
 *   supabaseAnonKey  → clave "anon" o "publishable" (NUNCA la clave "service_role" ni "secret")
 *
 * La clave anon/publishable está pensada para ir en aplicaciones web públicas:
 * los datos quedan protegidos porque las tablas solo permiten acceso a usuarios con sesión (ver supabase/esquema.sql).
 * Si se deja vacío, la app funciona en modo local (registros solo en este teléfono).
 */
self.TRANSFER_CONFIG = {
  supabaseUrl: 'https://xxmrenlyddjooifahhli.supabase.co',
  supabaseAnonKey: 'sb_publishable_3EkWsnZiRl-MUoUR0T_TWQ_5Re1IYKr'
};
