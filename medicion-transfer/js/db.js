/*
 * db.js — Base de datos de Medición Transfer.
 * - Guarda siempre primero en el teléfono (funciona sin señal).
 * - Si Supabase está configurado y hay sesión, sincroniza con la nube:
 *   sube lo pendiente y descarga los registros de todos los usuarios.
 */
(function (root) {
  'use strict';

  var LS_DATA = 'transfer.db.v2';
  var LS_SES = 'transfer.sesion.v1';
  var LS_CFG = 'transfer.nube.v1';
  var LS_SYNC = 'transfer.ultimasync.v1';
  var LIMITE_DESCARGA = 1000;

  var COMUNES = ['id', 'creado', 'modificado', 'usuario_email', 'fecha', 'maquina_serie', 'maquina_qr', 'maquina_asset',
    'maquina_linea', 'maquina_estacion', 'rubber_largo_cm', 'rubber_ancho_cm', 'area_cm2', 'area_in2'];

  var TABLAS = {
    calculo_presion: {
      nombre: 'Cálculo de presión',
      columnas: COMUNES.concat(['presion_deseada_psi', 'fuerza_lbf', 'fuerza_kgf', 'fuerza_n', 'capacidad_celda', 'observaciones'])
    },
    validacion_presion: {
      nombre: 'Validación de presión',
      columnas: COMUNES.concat(['lectura_valor', 'lectura_unidad', 'fuerza_lbf', 'fuerza_kgf', 'fuerza_n', 'presion_psi',
        'presion_kgfcm2', 'presion_bar', 'plancha_largo_cm', 'plancha_ancho_cm', 'plancha_area_cm2', 'fuerza_total_plancha',
        'plancha_presion_psi', 'capacidad_celda', 'observaciones'])
    },
    registro_pruebas: {
      nombre: 'Registro de pruebas',
      columnas: COMUNES.concat(['montaje', 'manometro_valor', 'manometro_unidad', 'manometro_psi', 'fuerza_valor', 'fuerza_unidad',
        'fuerza_lbf', 'fuerza_kgf', 'fuerza_n', 'presion_psi', 'presion_kgfcm2', 'presion_bar', 'temperatura',
        'temperatura_unidad', 'tiempo_s', 'capacidad_celda', 'observaciones'])
    }
  };

  function leerLS(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardarLS(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  var datos = leerLS(LS_DATA, null) || {};
  Object.keys(TABLAS).forEach(function (t) { if (!Array.isArray(datos[t])) datos[t] = []; });
  var sesion = leerLS(LS_SES, null);
  var estado = { fase: 'inactivo', mensaje: '', ultima: leerLS(LS_SYNC, null) };
  var sincronizando = false;
  var oyentes = [];
  var temporizador = null;

  function persistir() {
    try { guardarLS(LS_DATA, datos); }
    catch (e) { throw new Error('No hay espacio en el navegador para guardar (' + e.name + '). Exporta y sincroniza tus datos.'); }
  }
  function avisar() { oyentes.forEach(function (fn) { try { fn(); } catch (e) { /* nada */ } }); }
  function fijarEstado(fase, mensaje) { estado.fase = fase; estado.mensaje = mensaje || ''; avisar(); }

  // ---------- Configuración ----------
  function config() {
    var o = leerLS(LS_CFG, {}) || {};
    var c = root.TRANSFER_CONFIG || {};
    return {
      url: String(o.url || c.supabaseUrl || '').trim().replace(/\/+$/, ''),
      key: String(o.key || c.supabaseAnonKey || '').trim(),
      origen: o.url ? 'ajustes' : (c.supabaseUrl ? 'config.js' : ''),
      general: String(c.usuarioGeneral || '').trim().toLowerCase(),
      admins: (c.administradores || []).map(function (x) { return String(x).trim().toLowerCase(); })
    };
  }
  function configurada() { var c = config(); return !!(c.url && c.key); }
  /** Administrador = puede editar y eliminar. En modo local todos pueden. */
  function esAdmin() {
    if (!configurada()) return true;
    return !!(sesion && sesion.email && config().admins.indexOf(String(sesion.email).toLowerCase()) >= 0);
  }
  function guardarConfig(url, key) {
    if (!url && !key) localStorage.removeItem(LS_CFG);
    else guardarLS(LS_CFG, { url: url, key: key });
    avisar();
  }

  // ---------- Sesión (Supabase Auth por REST) ----------
  function guardarSesion(j) {
    sesion = {
      access: j.access_token, refresh: j.refresh_token,
      exp: Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000,
      email: j.user && j.user.email ? j.user.email : (sesion && sesion.email) || ''
    };
    guardarLS(LS_SES, sesion);
  }
  function cerrarSesionLocal() { sesion = null; localStorage.removeItem(LS_SES); avisar(); }

  async function iniciarSesion(email, clave) {
    var c = config();
    if (!configurada()) throw new Error('La base de datos en la nube no está configurada.');
    var r;
    try {
      r = await fetch(c.url + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: clave })
      });
    } catch (e) { throw new Error('Sin conexión con la base de datos. Revisa el internet.'); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      var m = j.error_description || j.msg || j.message || '';
      if (/invalid/i.test(m)) m = 'Correo o contraseña incorrectos.';
      throw new Error(m || 'No se pudo iniciar sesión (' + r.status + ').');
    }
    guardarSesion(j);
    avisar();
    sincronizar();
    return sesion.email;
  }

  async function cerrarSesion() {
    var c = config();
    if (sesion && configurada()) {
      try { await fetch(c.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: c.key, Authorization: 'Bearer ' + sesion.access } }); }
      catch (e) { /* sin conexión: se borra igual localmente */ }
    }
    cerrarSesionLocal();
  }

  async function sesionValida() {
    if (!sesion || !configurada()) return null;
    if (Date.now() < sesion.exp) return sesion;
    var c = config();
    var r;
    try {
      r = await fetch(c.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: sesion.refresh })
      });
    } catch (e) { return null; } // sin red: se intenta después
    if (!r.ok) { cerrarSesionLocal(); return null; }
    guardarSesion(await r.json());
    return sesion;
  }

  async function api(metodo, ruta, cuerpo, extra) {
    var c = config();
    var s = await sesionValida();
    if (!s) throw new Error('sin-sesion');
    var h = { apikey: c.key, Authorization: 'Bearer ' + s.access, 'Content-Type': 'application/json' };
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    var r = await fetch(c.url + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    if (r.status === 401) { cerrarSesionLocal(); throw new Error('sin-sesion'); }
    if (!r.ok) {
      var t = await r.text().catch(function () { return ''; });
      var msg = t;
      try { var j = JSON.parse(t); msg = j.message || j.hint || t; } catch (e) { /* texto */ }
      throw new Error('Error ' + r.status + ' de la base de datos: ' + msg);
    }
    if (r.status === 204) return null;
    var txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  // ---------- Registros (siempre locales primero) ----------
  function nuevoId() {
    if (root.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function listar(tabla) {
    return datos[tabla].filter(function (r) { return r._pend !== 'delete'; });
  }
  function obtener(tabla, id) {
    return datos[tabla].find(function (r) { return r.id === id && r._pend !== 'delete'; }) || null;
  }
  function guardar(tabla, reg) {
    if (!TABLAS[tabla]) throw new Error('Tabla desconocida: ' + tabla);
    var ahora = new Date().toISOString();
    var i = datos[tabla].findIndex(function (r) { return r.id === reg.id; });
    var fila = {};
    TABLAS[tabla].columnas.forEach(function (c) { fila[c] = reg[c] === undefined ? null : reg[c]; });
    if (i >= 0) {
      var prev = datos[tabla][i];
      fila.creado = prev.creado; fila.modificado = ahora;
      fila._srv = prev._srv; fila._v = (prev._v || 0) + 1;
      fila._pend = 'upsert';
      datos[tabla][i] = fila;
    } else {
      fila.id = fila.id || nuevoId();
      fila.creado = fila.creado || ahora;
      fila._v = 1; fila._pend = 'upsert';
      datos[tabla].push(fila);
    }
    persistir();
    avisar();
    programarSync(400);
    return fila;
  }
  function eliminar(tabla, id) {
    var i = datos[tabla].findIndex(function (r) { return r.id === id; });
    if (i < 0) return;
    if (!datos[tabla][i]._srv) datos[tabla].splice(i, 1); // nunca llegó a la nube
    else { datos[tabla][i]._pend = 'delete'; datos[tabla][i]._v = (datos[tabla][i]._v || 0) + 1; }
    persistir();
    avisar();
    programarSync(400);
  }
  /** Importa registros (respaldo o migración). Devuelve cuántos se agregaron o reemplazaron. */
  function importar(tabla, lista) {
    var n = 0;
    lista.forEach(function (reg) {
      var fila = {};
      TABLAS[tabla].columnas.forEach(function (c) { fila[c] = reg[c] === undefined ? null : reg[c]; });
      if (!fila.id) fila.id = nuevoId();
      if (!fila.creado) fila.creado = new Date().toISOString();
      fila._pend = 'upsert'; fila._v = 1;
      var i = datos[tabla].findIndex(function (r) { return r.id === fila.id; });
      if (i >= 0) { fila._srv = datos[tabla][i]._srv; datos[tabla][i] = fila; } else datos[tabla].push(fila);
      n++;
    });
    persistir();
    avisar();
    programarSync(400);
    return n;
  }
  function pendientes(tabla) {
    var ts = tabla ? [tabla] : Object.keys(TABLAS);
    return ts.reduce(function (s, t) { return s + datos[t].filter(function (r) { return r._pend; }).length; }, 0);
  }
  function limpiarParaNube(tabla, r) {
    var o = {};
    TABLAS[tabla].columnas.forEach(function (c) { o[c] = r[c] === undefined ? null : r[c]; });
    return o;
  }

  // ---------- Sincronización ----------
  function programarSync(ms) {
    clearTimeout(temporizador);
    temporizador = setTimeout(sincronizar, ms || 0);
  }

  async function sincronizar() {
    if (!configurada()) { fijarEstado('local', 'Base de datos en la nube no configurada.'); return { ok: false, motivo: 'sin-config' }; }
    if (!sesion) { fijarEstado('sin-sesion', 'Inicia sesión para sincronizar.'); return { ok: false, motivo: 'sin-sesion' }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { fijarEstado('sin-red', 'Sin conexión. Se sincronizará al volver la señal.'); return { ok: false, motivo: 'sin-red' }; }
    if (sincronizando) return { ok: false, motivo: 'en-curso' };
    sincronizando = true;
    fijarEstado('sincronizando', 'Sincronizando…');
    try {
      var tablas = Object.keys(TABLAS);
      for (var k = 0; k < tablas.length; k++) {
        var t = tablas[k];
        // 1) Subir altas y cambios
        var ups = datos[t].filter(function (r) { return r._pend === 'upsert'; });
        if (ups.length) {
          var versiones = ups.map(function (r) { return { id: r.id, v: r._v }; });
          for (var i = 0; i < ups.length; i += 200) {
            await api('POST', '/rest/v1/' + t + '?on_conflict=id', ups.slice(i, i + 200).map(function (r) { return limpiarParaNube(t, r); }),
              { Prefer: (esAdmin() ? 'resolution=merge-duplicates' : 'resolution=ignore-duplicates') + ',return=minimal' });
          }
          versiones.forEach(function (x) {
            var r = datos[t].find(function (y) { return y.id === x.id; });
            if (r && r._v === x.v && r._pend === 'upsert') { delete r._pend; r._srv = true; }
          });
          persistir();
        }
        // 2) Subir eliminaciones
        var dels = datos[t].filter(function (r) { return r._pend === 'delete'; });
        for (var j = 0; j < dels.length; j += 100) {
          var lote = dels.slice(j, j + 100);
          var ids = lote.map(function (r) { return '"' + String(r.id).replace(/"/g, '') + '"'; }).join(',');
          await api('DELETE', '/rest/v1/' + t + '?id=in.(' + encodeURIComponent(ids) + ')', undefined, { Prefer: 'return=minimal' });
          var borrados = {};
          lote.forEach(function (r) { borrados[r.id] = r._v; });
          datos[t] = datos[t].filter(function (r) { return !(r._pend === 'delete' && borrados[r.id] === r._v); });
          persistir();
        }
        // 3) Descargar lo de todos los usuarios
        var srv = await api('GET', '/rest/v1/' + t + '?select=' + TABLAS[t].columnas.join(',') + '&order=creado.desc&limit=' + LIMITE_DESCARGA);
        var locales = datos[t].filter(function (r) { return r._pend; });
        var idsLocales = {};
        locales.forEach(function (r) { idsLocales[r.id] = true; });
        datos[t] = (srv || []).filter(function (r) { return !idsLocales[r.id]; })
          .map(function (r) { r._srv = true; return r; }).concat(locales);
        persistir();
      }
      estado.ultima = new Date().toISOString();
      guardarLS(LS_SYNC, estado.ultima);
      fijarEstado('ok', 'Sincronizado');
      return { ok: true };
    } catch (e) {
      if (e.message === 'sin-sesion') { fijarEstado('sin-sesion', 'La sesión expiró. Inicia sesión de nuevo.'); return { ok: false, motivo: 'sin-sesion' }; }
      var sinRed = e instanceof TypeError;
      fijarEstado(sinRed ? 'sin-red' : 'error', sinRed ? 'Sin conexión con la base de datos. Los registros quedan guardados en el teléfono.' : e.message);
      return { ok: false, motivo: 'error', error: e.message };
    } finally {
      sincronizando = false;
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { programarSync(500); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') programarSync(300); });
    setInterval(function () { if (pendientes() || document.visibilityState === 'visible') programarSync(0); }, 120000);
  }

  root.DB = {
    TABLAS: TABLAS,
    config: config, configurada: configurada, guardarConfig: guardarConfig, esAdmin: esAdmin,
    sesion: function () { return sesion; }, iniciarSesion: iniciarSesion, cerrarSesion: cerrarSesion,
    listar: listar, obtener: obtener, guardar: guardar, eliminar: eliminar, importar: importar,
    pendientes: pendientes, sincronizar: sincronizar, programarSync: programarSync,
    estado: function () { return estado; },
    alCambiar: function (fn) { oyentes.push(fn); }
  };
})(self);
