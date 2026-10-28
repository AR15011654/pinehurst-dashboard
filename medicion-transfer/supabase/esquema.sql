-- =====================================================================
-- Medición Transfer — Base de datos (Supabase / PostgreSQL)
-- Ejecutar UNA vez en Supabase: SQL Editor → New query → pegar → Run.
-- Crea 3 tablas, una por módulo:
--   calculo_presion     → módulo "Cálculo de presión"
--   validacion_presion  → módulo "Validación de presión"
--   registro_pruebas    → módulo "Registro de pruebas" (espacio propio)
-- Solo usuarios con sesión iniciada pueden leer o agregar (RLS).
-- Solo los administradores (función es_admin) pueden editar o eliminar.
-- =====================================================================

-- ---------- 1. Cálculo de presión ----------
create table if not exists public.calculo_presion (
  id                   text primary key,               -- generado por la app (permite guardar sin conexión)
  creado               timestamptz not null default now(),
  modificado           timestamptz,
  usuario_id           uuid default auth.uid() references auth.users(id),
  usuario_email        text,
  fecha                date not null default current_date,
  maquina_serie        text not null,
  maquina_qr           text,
  maquina_asset        text,
  maquina_linea        text,
  maquina_estacion     text,
  rubber_largo_cm      numeric not null check (rubber_largo_cm > 0),
  rubber_ancho_cm      numeric not null check (rubber_ancho_cm > 0),
  area_cm2             numeric,
  area_in2             numeric,
  presion_deseada_psi  numeric not null check (presion_deseada_psi > 0),
  fuerza_lbf           numeric,
  fuerza_kgf           numeric,
  fuerza_n             numeric,
  capacidad_celda      text,
  observaciones        text
);

-- ---------- 2. Validación de presión ----------
create table if not exists public.validacion_presion (
  id                   text primary key,
  creado               timestamptz not null default now(),
  modificado           timestamptz,
  usuario_id           uuid default auth.uid() references auth.users(id),
  usuario_email        text,
  fecha                date not null default current_date,
  maquina_serie        text not null,
  maquina_qr           text,
  maquina_asset        text,
  maquina_linea        text,
  maquina_estacion     text,
  rubber_largo_cm      numeric not null check (rubber_largo_cm > 0),
  rubber_ancho_cm      numeric not null check (rubber_ancho_cm > 0),
  area_cm2             numeric,
  area_in2             numeric,
  lectura_valor        numeric not null check (lectura_valor > 0),
  lectura_unidad       text not null check (lectura_unidad in ('lbf','kgf','N')),
  fuerza_lbf           numeric,
  fuerza_kgf           numeric,
  fuerza_n             numeric,
  presion_psi          numeric,
  presion_kgfcm2       numeric,
  presion_bar          numeric,
  plancha_largo_cm     numeric,
  plancha_ancho_cm     numeric,
  plancha_area_cm2     numeric,
  fuerza_total_plancha boolean default false,
  plancha_presion_psi  numeric,
  capacidad_celda      text,
  observaciones        text
);

-- ---------- 3. Registro de pruebas (calibración por máquina) ----------
create table if not exists public.registro_pruebas (
  id                   text primary key,
  creado               timestamptz not null default now(),
  modificado           timestamptz,
  usuario_id           uuid default auth.uid() references auth.users(id),
  usuario_email        text,
  fecha                date not null,
  maquina_serie        text not null,
  maquina_qr           text,
  maquina_asset        text,
  maquina_linea        text,
  maquina_estacion     text,
  montaje              text,
  rubber_largo_cm      numeric not null check (rubber_largo_cm > 0),
  rubber_ancho_cm      numeric not null check (rubber_ancho_cm > 0),
  area_cm2             numeric,
  area_in2             numeric,
  manometro_valor      numeric not null check (manometro_valor > 0),
  manometro_unidad     text not null check (manometro_unidad in ('psi','bar','kgfcm2')),
  manometro_psi        numeric,
  fuerza_valor         numeric not null check (fuerza_valor > 0),
  fuerza_unidad        text not null check (fuerza_unidad in ('lbf','kgf','N')),
  fuerza_lbf           numeric,
  fuerza_kgf           numeric,
  fuerza_n             numeric,
  presion_psi          numeric,
  presion_kgfcm2       numeric,
  presion_bar          numeric,
  temperatura          numeric,
  temperatura_unidad   text,
  tiempo_s             numeric check (tiempo_s is null or tiempo_s > 0),
  capacidad_celda      text,
  observaciones        text
);

-- ---------- Índices ----------
create index if not exists calculo_presion_maquina_idx    on public.calculo_presion (maquina_serie, creado desc);
create index if not exists validacion_presion_maquina_idx on public.validacion_presion (maquina_serie, creado desc);
create index if not exists registro_pruebas_maquina_idx   on public.registro_pruebas (maquina_serie, creado desc);

-- ---------- Administradores: pueden editar y eliminar ----------
-- Para agregar otro administrador, añade su correo al arreglo y vuelve a ejecutar.
create or replace function public.es_admin() returns boolean
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array['irivera@pinehurstmfg.com'])
$$;

-- ---------- Seguridad: solo usuarios autenticados ----------
alter table public.calculo_presion    enable row level security;
alter table public.validacion_presion enable row level security;
alter table public.registro_pruebas   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['calculo_presion','validacion_presion','registro_pruebas'] loop
    execute format('drop policy if exists "leer autenticados" on public.%I', t);
    execute format('drop policy if exists "insertar autenticados" on public.%I', t);
    execute format('drop policy if exists "actualizar autenticados" on public.%I', t);
    execute format('drop policy if exists "eliminar autenticados" on public.%I', t);
    execute format('create policy "leer autenticados" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "insertar autenticados" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "actualizar autenticados" on public.%I for update to authenticated using (public.es_admin()) with check (public.es_admin())', t);
    execute format('create policy "eliminar autenticados" on public.%I for delete to authenticated using (public.es_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- Vista de resumen por módulo y máquina (opcional, para reportes) ----------
create or replace view public.resumen_mediciones
with (security_invoker = true) as
  select 'Cálculo de presión' as modulo, maquina_serie, count(*) as registros, max(creado) as ultimo from public.calculo_presion group by maquina_serie
  union all
  select 'Validación de presión', maquina_serie, count(*), max(creado) from public.validacion_presion group by maquina_serie
  union all
  select 'Registro de pruebas', maquina_serie, count(*), max(creado) from public.registro_pruebas group by maquina_serie;

grant select on public.resumen_mediciones to authenticated;
