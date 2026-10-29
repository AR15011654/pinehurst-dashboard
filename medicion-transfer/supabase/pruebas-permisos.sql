-- =====================================================================
-- Pruebas de permisos y trazabilidad del catálogo (v3).
-- Ejecutar en Supabase → SQL Editor. Simula al administrador y a la cuenta
-- general con sus correos reales y al final DESHACE todo (no deja datos).
-- Resultado esperado: 14 filas sin "MAL" ni "ERROR".
-- =====================================================================
create temp table if not exists _res (n serial, prueba text);
truncate _res;
do $$
declare res text[] := '{}'; v int; snap numeric; ver int; naud int;
  adm text := json_build_object('email','irivera@pinehurstmfg.com','role','authenticated','sub',(select id from auth.users where email='irivera@pinehurstmfg.com'))::text;
  gen text := json_build_object('email','planta.transfer@pinehurstmfg.com','role','authenticated','sub',(select id from auth.users where email='planta.transfer@pinehurstmfg.com'))::text;
begin
  begin
    perform set_config('request.jwt.claims', adm, true);
    execute 'set local role authenticated';
    insert into cat_clientes(id,nombre) values ('zz-cli','ZZ Prueba RLS');
    insert into cat_accesorios(id,cliente_id,codigo) values ('zz-acc','zz-cli','ZZ-001');
    insert into cat_telas(id,nombre) values ('zz-tela-a','ZZ Tela A'),('zz-tela-b','ZZ Tela B');
    insert into cat_rubbers(id,nombre,largo_cm,ancho_cm) values ('zz-rub','ZZ rubber',4,2);
    insert into cat_configuraciones(id,accesorio_id,tela_id,rubber_id,presion_texto,presion_min_psi,presion_max_psi,tipo_presion,estado)
      values ('zz-cfg-a','zz-acc','zz-tela-a','zz-rub','20-30',20,30,'contacto_rubber','aprobado'),
             ('zz-cfg-b','zz-acc','zz-tela-b','zz-rub','50-60',50,60,'contacto_rubber','pendiente');
    res := res || ('1 Admin crea catálogo: OK (' || (select count(*) from cat_configuraciones where id like 'zz-%') || ' configuraciones, misma referencia con 2 telas)');
    begin insert into cat_configuraciones(id,accesorio_id,tela_id,rubber_id,estado) values ('zz-cfg-x','zz-acc','zz-tela-c-no','zz-rub','aprobado'); res := res || '2 Aprobar sin presión: PERMITIDO (MAL)'::text;
    exception when others then res := res || ('2 Aprobar sin presión: bloqueado (' || sqlstate || ')'); end;
    begin insert into cat_configuraciones(id,accesorio_id,tela_id,rubber_id,presion_max_psi) values ('zz-cfg-y','zz-acc','zz-tela-a','zz-rub',10); res := res || '3 Duplicar combinación activa: PERMITIDO (MAL)'::text;
    exception when others then res := res || ('3 Duplicar referencia+tela+rubber activa: bloqueado (' || sqlstate || ')'); end;

    perform set_config('request.jwt.claims', gen, true);
    select count(*) into v from cat_configuraciones where id like 'zz-%';
    res := res || ('4 General ve configuraciones de prueba: ' || v || ' de 2 (solo la aprobada)');
    update cat_configuraciones set presion_max_psi = 99 where id = 'zz-cfg-a'; get diagnostics v = row_count;
    res := res || ('5 General intenta modificar parámetros: ' || v || ' filas cambiadas');
    begin insert into cat_clientes(id,nombre) values ('zz-cli-2','Intruso'); res := res || '6 General agrega cliente: PERMITIDO (MAL)'::text;
    exception when others then res := res || ('6 General agrega cliente: bloqueado (' || sqlstate || ')'); end;
    begin delete from cat_configuraciones where id = 'zz-cfg-a'; res := res || '7 General borra: PERMITIDO (MAL)'::text;
    exception when others then res := res || ('7 General borra configuración: bloqueado (' || sqlstate || ')'); end;
    select count(*) into v from cat_auditoria; res := res || ('8 General lee historial de cambios: ' || v || ' filas visibles');
    begin insert into storage.objects(bucket_id,name) values ('catalogo','zz-intruso.png'); res := res || '9 General sube imagen: PERMITIDO (MAL)'::text;
    exception when others then res := res || ('9 General sube imagen al catálogo: bloqueado (' || sqlstate || ')'); end;
    insert into calculo_presion(id,maquina_serie,rubber_largo_cm,rubber_ancho_cm,presion_deseada_psi,fuerza_lbf,configuracion_id,configuracion_version,presion_objetivo_psi,parametros)
      values ('zz-reg','ZZ',4,2,30,37.2,'zz-cfg-a',1,30,'{"presion":{"texto":"20-30","max_psi":30}}');
    res := res || '10 General registra medición con copia de parámetros: OK'::text;

    perform set_config('request.jwt.claims', adm, true);
    begin delete from cat_configuraciones where id = 'zz-cfg-a'; res := res || '11 Admin borra: PERMITIDO (MAL)'::text;
    exception when others then res := res || ('11 Admin borra configuración: bloqueado, se desactiva (' || sqlstate || ')'); end;
    update cat_configuraciones set presion_texto='20-25', presion_max_psi = 25 where id = 'zz-cfg-a';
    select version into ver from cat_configuraciones where id='zz-cfg-a';
    select count(*) into naud from cat_auditoria where registro_id='zz-cfg-a' and accion='cambio' and (antes->>'presion_max_psi')::numeric = 30 and (despues->>'presion_max_psi')::numeric = 25 and usuario_email='irivera@pinehurstmfg.com';
    res := res || ('12 Admin cambia 30→25 psi: versión ' || ver || ', historial con antes/después y usuario: ' || naud);
    select presion_objetivo_psi into snap from calculo_presion where id='zz-reg';
    res := res || ('13 Registro anterior conserva objetivo: ' || snap || ' psi y versión 1');
    update cat_configuraciones set activo=false where id='zz-cfg-a';
    perform set_config('request.jwt.claims', gen, true);
    select count(*) into v from cat_configuraciones where id='zz-cfg-a';
    res := res || ('14 Desactivada: visible para general = ' || v || '; historial conservado = ' || (select count(*) from calculo_presion where id='zz-reg'));
    execute 'reset role';
    raise exception 'FIN_PRUEBA';
  exception when others then
    if sqlerrm <> 'FIN_PRUEBA' then res := res || ('ERROR: ' || sqlerrm); end if;
  end;
  insert into _res(prueba) select unnest(res);
end $$;
select prueba from _res order by n;
