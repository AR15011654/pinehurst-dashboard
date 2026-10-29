-- =====================================================================
-- Medición Transfer v3 — Catálogo de parámetros de trims
-- Ejecutar UNA vez en Supabase: SQL Editor → New query → pegar → Run.
-- Es seguro volver a ejecutarlo. NO borra ni modifica registros existentes:
-- solo agrega tablas nuevas y columnas nuevas (vacías) a las tablas actuales.
--
-- Permisos (se aplican en el servidor con RLS, no solo en la app):
--   · Administrador (public.es_admin()): agrega, edita y desactiva el catálogo,
--     sube imágenes y consulta el historial de cambios.
--   · Cuenta general de planta: solo consulta configuraciones APROBADAS y
--     activas, y registra mediciones. No puede cambiar el catálogo.
--   · Nadie puede borrar filas del catálogo: se desactivan para conservar historial.
-- =====================================================================

-- ---------- Clientes ----------
create table if not exists public.cat_clientes (
  id             text primary key,
  nombre         text not null check (length(trim(nombre)) > 0),
  activo         boolean not null default true,
  clave_import   text unique,
  version        integer not null default 1,
  creado         timestamptz not null default now(),
  creado_por     text,
  modificado     timestamptz,
  modificado_por text
);
create unique index if not exists cat_clientes_nombre_uq on public.cat_clientes (lower(trim(nombre)));

-- ---------- Proveedores ----------
create table if not exists public.cat_proveedores (
  id             text primary key,
  nombre         text not null check (length(trim(nombre)) > 0),
  activo         boolean not null default true,
  clave_import   text unique,
  version        integer not null default 1,
  creado         timestamptz not null default now(),
  creado_por     text,
  modificado     timestamptz,
  modificado_por text
);
create unique index if not exists cat_proveedores_nombre_uq on public.cat_proveedores (lower(trim(nombre)));

-- ---------- Tipos de tela ----------
create table if not exists public.cat_telas (
  id             text primary key,
  nombre         text not null check (length(trim(nombre)) > 0),
  activo         boolean not null default true,
  clave_import   text unique,
  version        integer not null default 1,
  creado         timestamptz not null default now(),
  creado_por     text,
  modificado     timestamptz,
  modificado_por text
);

-- ---------- Referencias de accesorios / logos ----------
create table if not exists public.cat_accesorios (
  id              text primary key,
  cliente_id      text not null references public.cat_clientes(id),
  codigo          text not null check (length(trim(codigo)) > 0),
  descripcion     text,
  imagen          text,                         -- ruta en Storage (bucket "catalogo")
  imagenes_extra  jsonb not null default '[]'::jsonb,
  activo          boolean not null default true,
  clave_import    text unique,
  version         integer not null default 1,
  creado          timestamptz not null default now(),
  creado_por      text,
  modificado      timestamptz,
  modificado_por  text
);
create index if not exists cat_accesorios_cliente_idx on public.cat_accesorios (cliente_id);

-- ---------- Rubbers o moldes ----------
create table if not exists public.cat_rubbers (
  id              text primary key,
  nombre          text not null check (length(trim(nombre)) > 0),
  tipo            text,
  descripcion     text,
  largo_cm        numeric check (largo_cm is null or largo_cm > 0),
  ancho_cm        numeric check (ancho_cm is null or ancho_cm > 0),
  imagen          text,
  imagenes_extra  jsonb not null default '[]'::jsonb,
  cliente_id      text references public.cat_clientes(id),
  activo          boolean not null default true,
  clave_import    text unique,
  version         integer not null default 1,
  creado          timestamptz not null default now(),
  creado_por      text,
  modificado      timestamptz,
  modificado_por  text
);

-- ---------- Parámetros por combinación referencia + tela + rubber ----------
create table if not exists public.cat_configuraciones (
  id                    text primary key,
  accesorio_id          text not null references public.cat_accesorios(id),
  tela_id               text references public.cat_telas(id),
  rubber_id             text references public.cat_rubbers(id),
  proveedor_id          text references public.cat_proveedores(id),
  temperatura_texto     text,                  -- texto original (ej. "155-160")
  temperatura_min       numeric,
  temperatura_max       numeric,
  temperatura_unidad    text check (temperatura_unidad is null or temperatura_unidad in ('°C','°F')),
  presion_texto         text,                  -- texto original (ej. "25-30 psi")
  presion_min_psi       numeric check (presion_min_psi is null or presion_min_psi > 0),
  presion_max_psi       numeric check (presion_max_psi is null or presion_max_psi > 0),
  tipo_presion          text not null default 'pendiente'
                          check (tipo_presion in ('pendiente','contacto_rubber','aire_manometro')),
  tiempo_texto          text,                  -- instrucción tal cual (puede tener varias pasadas)
  desprendimiento       text check (desprendimiento is null or desprendimiento in ('frio','caliente','otro')),
  desprendimiento_texto text,
  observaciones         text,                  -- instrucciones / notas del proveedor
  pruebas_internas      text,                  -- parámetros usados en pruebas internas (no son del proveedor)
  fecha_texto           text,
  fecha                 date,
  origen                text,                  -- ej. "Excel Milwaukee fila 5"
  estado                text not null default 'pendiente' check (estado in ('pendiente','aprobado')),
  activo                boolean not null default true,
  clave_import          text unique,
  version               integer not null default 1,
  creado                timestamptz not null default now(),
  creado_por            text,
  modificado            timestamptz,
  modificado_por        text,
  constraint cat_config_rango_ok check (presion_min_psi is null or presion_max_psi is null or presion_min_psi <= presion_max_psi),
  -- Una configuración aprobada debe tener al menos referencia, rubber y presión.
  constraint cat_config_aprobada_completa check (estado <> 'aprobado' or (rubber_id is not null and presion_max_psi is not null))
);
create index if not exists cat_config_accesorio_idx on public.cat_configuraciones (accesorio_id);
-- No puede haber dos configuraciones activas para la misma referencia + tela + rubber.
create unique index if not exists cat_config_combinacion_uq
  on public.cat_configuraciones (accesorio_id, coalesce(tela_id, '-'), coalesce(rubber_id, '-')) where activo;

-- ---------- Historial de cambios del catálogo ----------
create table if not exists public.cat_auditoria (
  id             bigserial primary key,
  fecha          timestamptz not null default now(),
  usuario_email  text,
  tabla          text not null,
  registro_id    text not null,
  accion         text not null,
  version        integer,
  antes          jsonb,
  despues        jsonb
);
create index if not exists cat_auditoria_registro_idx on public.cat_auditoria (registro_id, fecha desc);

-- Quién y cuándo; versión +1 en cada cambio.
create or replace function public.cat_sellar() returns trigger
language plpgsql as $$
declare quien text := coalesce(auth.jwt() ->> 'email', current_user);
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.creado := coalesce(new.creado, now());
    new.creado_por := quien;
    new.modificado := null;
    new.modificado_por := null;
  else
    new.version := old.version + 1;
    new.creado := old.creado;
    new.creado_por := old.creado_por;
    new.modificado := now();
    new.modificado_por := quien;
  end if;
  return new;
end $$;

-- Copia de valores anteriores y nuevos (solo lo escribe el servidor).
create or replace function public.cat_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cat_auditoria (usuario_email, tabla, registro_id, accion, version, antes, despues)
  values (coalesce(auth.jwt() ->> 'email', current_user), tg_table_name, new.id,
          case when tg_op = 'INSERT' then 'alta' else 'cambio' end, new.version,
          case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cat_clientes','cat_proveedores','cat_telas','cat_accesorios','cat_rubbers','cat_configuraciones'] loop
    execute format('drop trigger if exists sellar on public.%I', t);
    execute format('create trigger sellar before insert or update on public.%I for each row execute function public.cat_sellar()', t);
    execute format('drop trigger if exists auditar on public.%I', t);
    execute format('create trigger auditar after insert or update on public.%I for each row execute function public.cat_auditar()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "cat leer" on public.%I', t);
    execute format('drop policy if exists "cat agregar admin" on public.%I', t);
    execute format('drop policy if exists "cat cambiar admin" on public.%I', t);
    if t = 'cat_configuraciones' then
      -- La cuenta general solo ve configuraciones aprobadas y activas.
      execute format('create policy "cat leer" on public.%I for select to authenticated using (public.es_admin() or (estado = ''aprobado'' and activo))', t);
    else
      execute format('create policy "cat leer" on public.%I for select to authenticated using (public.es_admin() or activo)', t);
    end if;
    execute format('create policy "cat agregar admin" on public.%I for insert to authenticated with check (public.es_admin())', t);
    execute format('create policy "cat cambiar admin" on public.%I for update to authenticated using (public.es_admin()) with check (public.es_admin())', t);
    -- Sin política de borrado: nadie borra; se desactiva.
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke delete, truncate on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.cat_auditoria enable row level security;
drop policy if exists "auditoria leer admin" on public.cat_auditoria;
create policy "auditoria leer admin" on public.cat_auditoria for select to authenticated using (public.es_admin());
revoke all on public.cat_auditoria from anon;
revoke insert, update, delete, truncate on public.cat_auditoria from authenticated;
grant select on public.cat_auditoria to authenticated;

-- ---------- Imágenes del catálogo (Storage privado) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo', 'catalogo', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "catalogo leer autenticados" on storage.objects;
drop policy if exists "catalogo subir admin" on storage.objects;
drop policy if exists "catalogo cambiar admin" on storage.objects;
create policy "catalogo leer autenticados" on storage.objects for select to authenticated using (bucket_id = 'catalogo');
create policy "catalogo subir admin" on storage.objects for insert to authenticated with check (bucket_id = 'catalogo' and public.es_admin());
create policy "catalogo cambiar admin" on storage.objects for update to authenticated using (bucket_id = 'catalogo' and public.es_admin()) with check (bucket_id = 'catalogo' and public.es_admin());

-- ---------- Registros: combinación usada y copia de los parámetros ----------
-- Columnas nuevas y vacías: los registros anteriores quedan intactos.
do $$
declare t text;
begin
  foreach t in array array['calculo_presion','validacion_presion','registro_pruebas'] loop
    execute format('alter table public.%I add column if not exists configuracion_id text', t);
    execute format('alter table public.%I add column if not exists configuracion_version integer', t);
    execute format('alter table public.%I add column if not exists cliente text', t);
    execute format('alter table public.%I add column if not exists accesorio_codigo text', t);
    execute format('alter table public.%I add column if not exists accesorio_referencia text', t);
    execute format('alter table public.%I add column if not exists tela text', t);
    execute format('alter table public.%I add column if not exists proveedor text', t);
    execute format('alter table public.%I add column if not exists rubber text', t);
    execute format('alter table public.%I add column if not exists presion_rango text', t);
    execute format('alter table public.%I add column if not exists presion_objetivo_psi numeric', t);
    execute format('alter table public.%I add column if not exists tipo_presion text', t);
    execute format('alter table public.%I add column if not exists fuerza_objetivo_lbf numeric', t);
    execute format('alter table public.%I add column if not exists fuerza_objetivo_kgf numeric', t);
    execute format('alter table public.%I add column if not exists fuerza_objetivo_n numeric', t);
    execute format('alter table public.%I add column if not exists parametros jsonb', t);
  end loop;
end $$;

-- ---------- v3.1: lectura mínima del dinamómetro en cada registro ----------
-- (la máxima ya se guarda en presion_objetivo_psi y fuerza_objetivo_*)
do $$
declare t text;
begin
  foreach t in array array['calculo_presion','validacion_presion','registro_pruebas'] loop
    execute format('alter table public.%I add column if not exists presion_objetivo_min_psi numeric', t);
    execute format('alter table public.%I add column if not exists fuerza_objetivo_min_lbf numeric', t);
    execute format('alter table public.%I add column if not exists fuerza_objetivo_min_kgf numeric', t);
    execute format('alter table public.%I add column if not exists fuerza_objetivo_min_n numeric', t);
  end loop;
end $$;
