/*
 * admin.js — Catálogo de parámetros (solo administrador).
 * Agregar, editar y desactivar clientes, proveedores, telas, referencias, rubbers y parámetros;
 * importar "Parametros de Trims" (.xlsx) con vista previa; historial de cambios.
 * La app oculta esta sección a la cuenta general, pero la protección real está en el servidor (RLS).
 */
(function () {
  'use strict';
  var U, DB = window.DB, C = window.Calc;
  var $, $$, esc, f, num;

  var tab = 'cat_configuraciones';
  var busqueda = {};
  var filtroConf = 'todas';
  var edicion = null;      // { tabla, fila }
  var imp = null;          // estado de la importación en curso

  var NOMBRE_DESP = { frio: 'En frío', caliente: 'En caliente', otro: 'Otra instrucción' };
  var SELLO = { id: 1, version: 1, creado: 1, creado_por: 1, modificado: 1, modificado_por: 1, clave_import: 1 };
  var ETQ = {
    nombre: 'Nombre', activo: 'Activo', codigo: 'Código', descripcion: 'Descripción', imagen: 'Imagen', imagenes_extra: 'Imágenes adicionales',
    cliente_id: 'Cliente', tipo: 'Tipo', largo_cm: 'Largo (cm)', ancho_cm: 'Ancho (cm)', accesorio_id: 'Referencia', tela_id: 'Tela',
    rubber_id: 'Rubber', proveedor_id: 'Proveedor', temperatura_texto: 'Temperatura (texto original)', temperatura_min: 'Temp. mínima',
    temperatura_max: 'Temp. máxima', temperatura_unidad: 'Unidad de temperatura', presion_texto: 'Presión (texto original)',
    presion_min_psi: 'Presión mínima (psi)', presion_max_psi: 'Presión máxima (psi)', tipo_presion: 'Tipo de presión',
    tiempo_texto: 'Tiempo / secuencia', desprendimiento: 'Desprendimiento', desprendimiento_texto: 'Desprendimiento (texto original)',
    observaciones: 'Observaciones', pruebas_internas: 'Pruebas internas', fecha_texto: 'Fecha (texto original)', fecha: 'Fecha',
    origen: 'Origen', estado: 'Estado'
  };

  function cat() { return DB.catalogo(); }
  function porId(t) { var m = {}; cat()[t].forEach(function (x) { m[x.id] = x; }); return m; }
  function puede() { return DB.esAdmin() && (!DB.configurada() || !!DB.sesion()); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  // ------------------------------------------------------------------
  // Etiquetas
  // ------------------------------------------------------------------
  function nombreDe(t, id) {
    if (!id) return '';
    var x = porId(t)[id];
    if (!x) return '(' + id.slice(0, 8) + ')';
    return etiqueta(t, x);
  }
  function etiqueta(t, x) {
    if (!x) return '';
    if (t === 'cat_accesorios') return x.codigo + (x.descripcion ? ' · ' + x.descripcion : '');
    if (t === 'cat_configuraciones') {
      var a = porId('cat_accesorios')[x.accesorio_id] || {};
      return nombreDe('cat_clientes', a.cliente_id) + ' · ' + (a.codigo || '?') + ' · ' + (x.tela_id ? nombreDe('cat_telas', x.tela_id) : 'sin tela') +
        ' · ' + (x.rubber_id ? nombreDe('cat_rubbers', x.rubber_id) : 'sin rubber');
    }
    return x.nombre || x.id;
  }
  function faltantes(c) {
    var r = porId('cat_rubbers')[c.rubber_id];
    var l = [];
    if (!c.rubber_id) l.push('rubber');
    else if (!(num(r && r.largo_cm) > 0 && num(r && r.ancho_cm) > 0)) l.push('dimensiones del rubber');
    if (!(num(c.presion_max_psi) > 0)) l.push('presión');
    if (c.tipo_presion === 'pendiente') l.push('tipo de presión');
    if (!c.tela_id) l.push('tela');
    if (c.temperatura_texto && !c.temperatura_unidad) l.push('unidad de temperatura');
    return l;
  }

  // ------------------------------------------------------------------
  // Vista principal
  // ------------------------------------------------------------------
  function render() {
    if (!iniciado) iniciar();
    var est = $('#ad-estado'), cont = $('#ad-contenido');
    if (!puede()) {
      cont.hidden = true;
      est.innerHTML = U.aviso('peligro', 'Solo para el administrador',
        'Esta sección permite cambiar el catálogo de parámetros. La cuenta general de planta solo consulta configuraciones aprobadas.' +
        (DB.configurada() ? '<div class="acciones"><button type="button" class="btn btn-primario" data-accion="login">Entrar como administrador</button></div>' : ''));
      return;
    }
    cont.hidden = false;
    var e = DB.catEstado(), c = cat();
    var aprob = c.cat_configuraciones.filter(function (x) { return x.activo && x.estado === 'aprobado'; }).length;
    var pend = c.cat_configuraciones.filter(function (x) { return x.activo && x.estado !== 'aprobado'; }).length;
    est.innerHTML = '<div class="card card-bd"><div><p><b>' + (DB.configurada() ? 'Catálogo en la base de datos' : 'Modo local (pruebas)') + '</b></p>' +
      '<p class="msg' + (e.error ? ' err' : '') + '">' + (e.error ? esc(e.error) : (e.ultima ? 'Descargado: ' + esc(U.fechaHora(e.ultima)) : 'Aún no descargado')) +
      ' · ' + aprob + ' aprobadas · ' + pend + ' pendientes · ' + c.cat_accesorios.length + ' referencias</p></div>' +
      (DB.configurada() ? '<div class="acciones"><button type="button" class="btn" data-accion="sync">Actualizar</button></div>' : '') + '</div>';
    $$('#ad-tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
    if (tab === 'importar') return renderImportar();
    if (tab === 'historial') return renderHistorial();
    renderLista();
  }
  function alCambiarDatos() { if (tab !== 'importar' && !(edicion && $('#dlg-cat').open)) render(); }

  // ------------------------------------------------------------------
  // Listas con buscador
  // ------------------------------------------------------------------
  var TITULOS = { cat_configuraciones: 'parámetros', cat_accesorios: 'referencia', cat_rubbers: 'rubber', cat_clientes: 'cliente', cat_proveedores: 'proveedor', cat_telas: 'tela' };
  function renderLista() {
    var t = tab, q = busqueda[t] || '';
    var html = '<div class="card"><div class="barra-lista"><input type="search" id="ad-buscar" placeholder="Buscar…" value="' + esc(q) + '">' +
      '<button type="button" class="btn btn-primario" id="ad-agregar">+ Agregar ' + TITULOS[t] + '</button></div>';
    if (t === 'cat_configuraciones') {
      html += '<div class="filtros">' + [['todas', 'Todas'], ['pendiente', 'Pendientes'], ['aprobado', 'Aprobadas'], ['faltan', 'Con datos faltantes'], ['inactivas', 'Desactivadas']].map(function (x) {
        return '<button type="button" class="chip-filtro' + (filtroConf === x[0] ? ' activo' : '') + '" data-filtro="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
    }
    var lista = cat()[t].slice();
    var nq = norm(q);
    if (nq) lista = lista.filter(function (x) { return norm(textoBusqueda(t, x)).indexOf(nq) >= 0; });
    if (t === 'cat_configuraciones') {
      lista = lista.filter(function (x) {
        if (filtroConf === 'inactivas') return !x.activo;
        if (!x.activo) return filtroConf === 'todas';
        if (filtroConf === 'pendiente') return x.estado !== 'aprobado';
        if (filtroConf === 'aprobado') return x.estado === 'aprobado';
        if (filtroConf === 'faltan') return faltantes(x).length > 0;
        return true;
      });
    }
    lista.sort(function (a, b) { return (b.activo ? 1 : 0) - (a.activo ? 1 : 0) || etiqueta(t, a).localeCompare(etiqueta(t, b)); });
    html += '<p class="msg">' + lista.length + ' de ' + cat()[t].length + '</p><div class="cat-lista">' +
      (lista.map(function (x) { return tarjeta(t, x); }).join('') || U.vacio(cat()[t].length ? 'Nada coincide con la búsqueda.' : 'Aún no hay elementos. Agrega uno o importa el Excel.')) + '</div></div>';
    $('#ad-panel').innerHTML = html;
    U.cargarImagenes($('#ad-panel'));
    var b = $('#ad-buscar');
    b.addEventListener('input', function () { busqueda[t] = b.value; var pos = b.selectionStart; renderLista(); var nb = $('#ad-buscar'); nb.focus(); nb.setSelectionRange(pos, pos); });
    $('#ad-agregar').addEventListener('click', function () { abrirForm(t, null); });
  }
  function textoBusqueda(t, x) {
    if (t === 'cat_configuraciones') return etiqueta(t, x) + ' ' + nombreDe('cat_proveedores', x.proveedor_id) + ' ' + (x.presion_texto || '') + ' ' + (x.origen || '');
    if (t === 'cat_accesorios') return etiqueta(t, x) + ' ' + nombreDe('cat_clientes', x.cliente_id);
    if (t === 'cat_rubbers') return (x.nombre || '') + ' ' + (x.tipo || '') + ' ' + (x.descripcion || '') + ' ' + nombreDe('cat_clientes', x.cliente_id);
    return x.nombre || '';
  }
  function chip(txt, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(txt) + '</span>'; }
  function tarjeta(t, x) {
    var img = '', titulo = esc(etiqueta(t, x)), det = '', chips = '';
    if (!x.activo) chips += chip('Desactivado', 'chip-gris');
    if (t === 'cat_configuraciones') {
      var a = porId('cat_accesorios')[x.accesorio_id] || {}, r = porId('cat_rubbers')[x.rubber_id];
      img = U.imgHTML(a.imagen, a.codigo, 'thumb') + U.imgHTML(r ? r.imagen : null, 'rubber', 'thumb');
      titulo = '<b>' + esc(nombreDe('cat_clientes', a.cliente_id)) + ' · ' + esc(a.codigo || '?') + '</b>';
      var obj = C.fuerzaObjetivo(x, r || {});
      det = esc(x.tela_id ? nombreDe('cat_telas', x.tela_id) : 'Sin tela') + ' · ' + esc(r ? r.nombre : 'Sin rubber') +
        '<br>Presión ' + esc(x.presion_texto || '—') + (obj.presionObjetivo ? ' → objetivo ' + obj.presionObjetivo + ' psi' : '') +
        (obj.ok ? ' · <b>' + f(obj.fuerza.lbf) + ' lbf</b>' : '') + ' · v' + esc(x.version || 1) + (x.origen ? ' · ' + esc(x.origen) : '');
      chips += x.estado === 'aprobado' ? chip('Aprobado', 'chip-ok') : chip('Pendiente de validar', 'chip-pend');
      faltantes(x).forEach(function (m) { chips += chip('Falta ' + m, 'chip-falta'); });
    } else if (t === 'cat_accesorios') {
      img = U.imgHTML(x.imagen, x.codigo, 'thumb');
      titulo = '<b>' + esc(x.codigo) + '</b>' + (x.descripcion ? ' · ' + esc(x.descripcion) : '');
      var n = cat().cat_configuraciones.filter(function (c) { return c.accesorio_id === x.id; }).length;
      det = esc(nombreDe('cat_clientes', x.cliente_id)) + ' · ' + n + ' configuraci' + (n === 1 ? 'ón' : 'ones') + ((x.imagenes_extra || []).length ? ' · ' + x.imagenes_extra.length + ' imagen(es) adicional(es)' : '');
      if (!x.imagen) chips += chip('Sin imagen', 'chip-falta');
    } else if (t === 'cat_rubbers') {
      img = U.imgHTML(x.imagen, x.nombre, 'thumb');
      det = (x.tipo ? esc(x.tipo) + ' · ' : '') + (num(x.largo_cm) > 0 && num(x.ancho_cm) > 0 ? f(num(x.largo_cm)) + ' × ' + f(num(x.ancho_cm)) + ' cm' : '') +
        (x.cliente_id ? ' · ' + esc(nombreDe('cat_clientes', x.cliente_id)) : '') + (x.descripcion ? '<br>' + esc(x.descripcion) : '');
      if (!(num(x.largo_cm) > 0 && num(x.ancho_cm) > 0)) chips += chip('Faltan dimensiones', 'chip-falta');
    }
    return '<article class="cat-item">' + (img ? '<div class="cat-imgs">' + img + '</div>' : '') +
      '<div class="cat-txt"><div>' + titulo + '</div>' + (det ? '<div class="reg-meta">' + det + '</div>' : '') + (chips ? '<div class="chips">' + chips + '</div>' : '') + '</div>' +
      '<div class="cat-acc"><button type="button" class="btn btn-chico" data-editar="' + esc(x.id) + '">Editar</button>' +
      '<button type="button" class="btn btn-chico' + (x.activo ? ' btn-peligro' : '') + '" data-activo="' + esc(x.id) + '">' + (x.activo ? 'Desactivar' : 'Activar') + '</button></div></article>';
  }

  async function cambiarActivo(t, id) {
    var x = porId(t)[id];
    if (!x) return;
    var nuevo = !x.activo;
    if (!nuevo && !confirm('¿Desactivar "' + etiqueta(t, x) + '"? No se borra: deja de mostrarse a los técnicos y se conserva su historial.')) return;
    try {
      await DB.catGuardar(t, Object.assign({}, x, { activo: nuevo }));
      U.toast(nuevo ? 'Activado' : 'Desactivado');
      render(); U.refrescarCalculo();
    } catch (e) { U.toast(e.message, true); }
  }

  // ------------------------------------------------------------------
  // Formularios
  // ------------------------------------------------------------------
  function opciones(t, valor, vacioTxt, filtro) {
    var l = cat()[t].filter(function (x) { return (x.activo || x.id === valor) && (!filtro || filtro(x)); })
      .sort(function (a, b) { return etiqueta(t, a).localeCompare(etiqueta(t, b)); });
    return (vacioTxt !== null ? '<option value="">' + esc(vacioTxt) + '</option>' : '') +
      l.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === valor ? ' selected' : '') + '>' + esc(etiqueta(t, x)) + (x.activo ? '' : ' (desactivado)') + '</option>'; }).join('');
  }
  function campo(k, etq, control, ayuda) {
    return '<div class="campo" data-campo="' + k + '"><label for="cf-' + k + '">' + etq + '</label>' + control + (ayuda ? '<p class="ayuda">' + ayuda + '</p>' : '') + '<p class="error"></p></div>';
  }
  function txt(k, v, extra) { return '<input id="cf-' + k + '" type="text" autocomplete="off" value="' + esc(v === null || v === undefined ? '' : v) + '"' + (extra || '') + '>'; }
  function numero(k, v) { return '<input id="cf-' + k + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(v === null || v === undefined ? '' : v) + '">'; }
  function area(k, v) { return '<textarea id="cf-' + k + '" rows="2">' + esc(v || '') + '</textarea>'; }
  function selectHTML(k, ops) { return '<select id="cf-' + k + '">' + ops + '</select>'; }
  function lista(k, pares, v) { return selectHTML(k, pares.map(function (p) { return '<option value="' + esc(p[0]) + '"' + ((v || '') === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('')); }
  function check(k, v, etq) { return '<label class="check"><input type="checkbox" id="cf-' + k + '"' + (v ? ' checked' : '') + '><span>' + etq + '</span></label>'; }
  function imagenCampo(k, ruta) {
    return '<div class="campo campo-img" data-campo="' + k + '"><label>' + (k === 'imagen' ? 'Imagen principal' : 'Imagen') + '</label>' +
      '<div class="img-edit" id="cf-' + k + '-vista">' + U.imgHTML(ruta, '', 'img-grande') + '</div>' +
      '<input type="hidden" id="cf-' + k + '" value="' + esc(ruta || '') + '">' +
      '<div class="acciones"><label class="btn btn-chico">Cargar imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-subir="' + k + '" hidden></label>' +
      '<button type="button" class="btn btn-chico" data-quitar-img="' + k + '">Quitar</button></div><p class="msg" id="cf-' + k + '-msg"></p></div>';
  }
  function extrasCampo(rutas) {
    return '<div class="campo" data-campo="imagenes_extra"><label>Imágenes adicionales</label><div class="extras" id="cf-extras">' +
      (rutas || []).map(function (r) { return '<span class="extra" data-ruta-extra="' + esc(r) + '">' + U.imgHTML(r, '', 'thumb') + '<button type="button" class="btn btn-chico" data-quitar-extra="' + esc(r) + '">Quitar</button></span>'; }).join('') +
      '</div><label class="btn btn-chico">Agregar imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-subir="extra" hidden></label><p class="msg" id="cf-extra-msg"></p></div>';
  }

  function formHTML(t, x) {
    var h = '';
    if (t === 'cat_clientes' || t === 'cat_proveedores' || t === 'cat_telas') {
      h += campo('nombre', t === 'cat_telas' ? 'Tipo de tela (composición)' : 'Nombre', txt('nombre', x.nombre, ' required maxlength="200"'));
    } else if (t === 'cat_accesorios') {
      h += campo('cliente_id', 'Cliente', selectHTML('cliente_id', opciones('cat_clientes', x.cliente_id, 'Selecciona…')));
      h += campo('codigo', 'Código del accesorio', txt('codigo', x.codigo, ' maxlength="120"'));
      h += campo('descripcion', 'Referencia / descripción', txt('descripcion', x.descripcion, ' maxlength="300"'));
      h += imagenCampo('imagen', x.imagen) + extrasCampo(x.imagenes_extra);
    } else if (t === 'cat_rubbers') {
      h += campo('nombre', 'Nombre', txt('nombre', x.nombre, ' maxlength="200"'));
      h += campo('tipo', 'Tipo de rubber o molde', txt('tipo', x.tipo, ' maxlength="120" placeholder="Ej. Rubber rojo rígido"'));
      h += campo('descripcion', 'Descripción', txt('descripcion', x.descripcion, ' maxlength="300"'));
      h += '<div class="fila-2">' + campo('largo_cm', 'Largo (cm)', numero('largo_cm', x.largo_cm)) + campo('ancho_cm', 'Ancho (cm)', numero('ancho_cm', x.ancho_cm)) + '</div>';
      h += '<p class="ayuda">Dimensiones del área efectiva de contacto. Si no las conoces, déjalas vacías: la app no calculará la lectura objetivo.</p>';
      h += campo('cliente_id', 'Cliente (opcional, para organizar)', selectHTML('cliente_id', opciones('cat_clientes', x.cliente_id, 'Sin cliente')));
      h += imagenCampo('imagen', x.imagen) + extrasCampo(x.imagenes_extra);
    } else if (t === 'cat_configuraciones') {
      var a = porId('cat_accesorios')[x.accesorio_id];
      var cli = a ? a.cliente_id : (edicion.cliente || '');
      h += campo('cliente_sel', 'Cliente', '<select id="cf-cliente_sel">' + opciones('cat_clientes', cli, 'Selecciona…') + '</select>');
      h += campo('accesorio_id', 'Referencia del accesorio', selectHTML('accesorio_id', opciones('cat_accesorios', x.accesorio_id, 'Selecciona…', function (y) { return y.cliente_id === cli; })));
      h += campo('tela_id', 'Tipo de tela', selectHTML('tela_id', opciones('cat_telas', x.tela_id, 'No especificada')));
      h += campo('rubber_id', 'Rubber o molde', selectHTML('rubber_id', opcionesRubber(x.rubber_id, cli)));
      h += campo('proveedor_id', 'Proveedor', selectHTML('proveedor_id', opciones('cat_proveedores', x.proveedor_id, 'No indicado')));
      h += '<h3>Presión</h3>';
      h += campo('presion_texto', 'Presión según proveedor (texto original)', txt('presion_texto', x.presion_texto, ' placeholder="Ej. 20-30 psi"'), 'Al escribir un número o rango se completan mínimo y máximo.');
      h += '<div class="fila-2">' + campo('presion_min_psi', 'Mínima (psi)', numero('presion_min_psi', x.presion_min_psi)) + campo('presion_max_psi', 'Máxima (psi)', numero('presion_max_psi', x.presion_max_psi)) + '</div>';
      h += campo('tipo_presion', '¿Qué representa esta presión?', lista('tipo_presion', [['pendiente', 'Pendiente de confirmar'], ['contacto_rubber', 'Presión de contacto sobre el rubber'], ['aire_manometro', 'Presión del aire del manómetro']], x.tipo_presion || 'pendiente'),
        'Solo con "contacto sobre el rubber" se calcula la lectura objetivo del dinamómetro.');
      h += '<h3>Instrucciones de aplicación</h3>';
      h += campo('temperatura_texto', 'Temperatura (texto original)', txt('temperatura_texto', x.temperatura_texto, ' placeholder="Ej. 155-160"'));
      h += '<div class="fila-3">' + campo('temperatura_min', 'Mínima', numero('temperatura_min', x.temperatura_min)) + campo('temperatura_max', 'Máxima', numero('temperatura_max', x.temperatura_max)) +
        campo('temperatura_unidad', 'Unidad', lista('temperatura_unidad', [['', 'Sin indicar'], ['°C', '°C'], ['°F', '°F']], x.temperatura_unidad)) + '</div>';
      h += campo('tiempo_texto', 'Tiempo o secuencia de aplicación', area('tiempo_texto', x.tiempo_texto), 'Se muestra tal cual; no se convierte en un único tiempo.');
      h += '<div class="fila-2">' + campo('desprendimiento', 'Desprendimiento del film', lista('desprendimiento', [['', 'Sin indicar'], ['frio', 'En frío'], ['caliente', 'En caliente'], ['otro', 'Otra instrucción']], x.desprendimiento)) +
        campo('desprendimiento_texto', 'Texto original', txt('desprendimiento_texto', x.desprendimiento_texto)) + '</div>';
      h += campo('observaciones', 'Observaciones del proveedor / de aplicación', area('observaciones', x.observaciones));
      h += campo('pruebas_internas', 'Parámetros usados en pruebas internas', area('pruebas_internas', x.pruebas_internas), 'Se muestran aparte: no reemplazan los parámetros del proveedor.');
      h += '<div class="fila-2">' + campo('fecha', 'Fecha', '<input id="cf-fecha" type="date" value="' + esc(x.fecha || '') + '">') + campo('fecha_texto', 'Fecha (texto original)', txt('fecha_texto', x.fecha_texto)) + '</div>';
      if (x.origen) h += '<p class="ayuda">Origen: ' + esc(x.origen) + '</p>';
      h += '<h3>Estado</h3>';
      h += campo('estado', 'Estado', lista('estado', [['pendiente', 'Pendiente de validar'], ['aprobado', 'Aprobado']], x.estado || 'pendiente'));
      h += '<div id="cf-revision"></div>';
    }
    h += check('activo', x.activo !== false, 'Activo (desmarca para desactivar sin borrar)');
    return h;
  }
  function opcionesRubber(valor, cli) {
    var todos = cat().cat_rubbers.filter(function (r) { return r.activo || r.id === valor; });
    var op = function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === valor ? ' selected' : '') + '>' + esc(r.nombre + (num(r.largo_cm) > 0 && num(r.ancho_cm) > 0 ? ' · ' + f(num(r.largo_cm)) + '×' + f(num(r.ancho_cm)) + ' cm' : ' · sin dimensiones')) + '</option>'; };
    var deCli = todos.filter(function (r) { return cli && r.cliente_id === cli; }), otros = todos.filter(function (r) { return !cli || r.cliente_id !== cli; });
    return '<option value="">Sin asignar</option>' + (deCli.length ? '<optgroup label="De este cliente">' + deCli.map(op).join('') + '</optgroup>' : '') +
      (otros.length ? '<optgroup label="Otros">' + otros.map(op).join('') + '</optgroup>' : '');
  }

  function abrirForm(t, id, preset) {
    if (!puede()) { U.toast('Solo el administrador puede modificar el catálogo.', true); return; }
    var x = id ? JSON.parse(JSON.stringify(porId(t)[id])) : Object.assign({ activo: true }, preset || {});
    edicion = { tabla: t, fila: x, cliente: preset && preset.cliente || '' };
    $('#t-cat').textContent = (id ? 'Editar ' : 'Agregar ') + TITULOS[t] + (id && x.version ? ' (v' + x.version + ')' : '');
    $('#cat-campos').innerHTML = formHTML(t, x);
    $('#cat-msg').textContent = '';
    $('#cat-historial-box').hidden = !id;
    $('#cat-historial-box').open = false;
    $('#cat-historial').innerHTML = '';
    U.cargarImagenes($('#cat-campos'));
    if (t === 'cat_configuraciones') prepararFormConfig();
    U.abrirDialogo($('#dlg-cat'));
  }

  function valor(k) { var el = $('#cf-' + k); return el ? el.value.trim() : undefined; }
  function numOpc(k) {
    var v = valor(k);
    if (v === undefined || v === '') return null;
    var n = C.parseNumero(v);
    if (isNaN(n)) throw new Error(ETQ[k] + ': escribe un número válido.');
    return n;
  }
  function leerForm() {
    var t = edicion.tabla, x = Object.assign({}, edicion.fila);
    var campos = DB.CAT_TABLAS[t].columnas;
    campos.forEach(function (k) {
      if (k === 'id' || k === 'clave_import' || k === 'origen') return;
      var el = $('#cf-' + k);
      if (k === 'imagenes_extra') { if ($('#cf-extras')) x[k] = $$('[data-ruta-extra]', $('#cf-extras')).map(function (s) { return s.dataset.rutaExtra; }); return; }
      if (!el) return;
      if (k === 'activo') { x[k] = el.checked; return; }
      if (/_min|_max|_cm$/.test(k)) { x[k] = numOpc(k); return; }
      x[k] = el.value.trim() || null;
    });
    return x;
  }

  function prepararFormConfig() {
    var selCli = $('#cf-cliente_sel');
    selCli.addEventListener('change', function () {
      $('#cf-accesorio_id').innerHTML = opciones('cat_accesorios', null, 'Selecciona…', function (y) { return y.cliente_id === selCli.value; });
      $('#cf-rubber_id').innerHTML = opcionesRubber($('#cf-rubber_id').value, selCli.value);
      revisarConfig();
    });
    var auto = function (texto, min, max) {
      $('#cf-' + texto).addEventListener('input', function () {
        var r = C.parseRango(this.value);
        if (r) { $('#cf-' + min).value = r.min; $('#cf-' + max).value = r.max; }
        revisarConfig();
      });
    };
    auto('presion_texto', 'presion_min_psi', 'presion_max_psi');
    auto('temperatura_texto', 'temperatura_min', 'temperatura_max');
    $('#cf-temperatura_texto').addEventListener('input', function () {
      var r = C.parseRango(this.value);
      if (r && (r.unidad === '°C' || r.unidad === '°F')) $('#cf-temperatura_unidad').value = r.unidad;
    });
    ['accesorio_id', 'tela_id', 'rubber_id', 'presion_min_psi', 'presion_max_psi', 'tipo_presion', 'estado', 'temperatura_unidad'].forEach(function (k) {
      $('#cf-' + k).addEventListener($('#cf-' + k).tagName === 'SELECT' ? 'change' : 'input', revisarConfig);
    });
    revisarConfig();
  }
  function revisarConfig() {
    var out = $('#cf-revision');
    if (!out) return;
    var x;
    try { x = leerForm(); } catch (e) { out.innerHTML = U.aviso('alerta', 'Revisa los números', esc(e.message)); return; }
    var r = porId('cat_rubbers')[x.rubber_id];
    var k = C.fuerzaObjetivo(x, r || {});
    var faltaAprobar = [];
    if (!x.accesorio_id) faltaAprobar.push('referencia');
    if (!x.rubber_id) faltaAprobar.push('rubber');
    if (!(x.presion_max_psi > 0)) faltaAprobar.push('presión');
    var html = '';
    if (x.estado === 'aprobado' && faltaAprobar.length) html += U.aviso('peligro', 'No se puede aprobar todavía', 'Falta: ' + faltaAprobar.join(', ') + '. Guárdala como pendiente de validar.');
    if (k.ok) html += U.aviso('ok', 'Lectura objetivo para el técnico', f(k.fuerza.lbf) + ' lbf · ' + f(k.fuerza.kgf) + ' kgf · ' + f(k.fuerza.N) + ' N (' + k.presionObjetivo + ' psi = máximo del rango)');
    else html += U.aviso('info', 'El técnico no verá una lectura objetivo', '<ul>' + k.motivos.map(function (m) { return '<li>' + esc(m.texto) + '</li>'; }).join('') + '</ul>' +
      (x.estado === 'aprobado' && !faltaAprobar.length ? 'Puede aprobarse: verá los parámetros como instrucciones, sin fuerza objetivo.' : ''));
    out.innerHTML = html;
  }

  async function guardarForm(ev) {
    ev.preventDefault();
    var msg = $('#cat-msg'), b = $('#cat-guardar');
    var x;
    try { x = leerForm(); } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; return; }
    var err = DB.validarCat(edicion.tabla, Object.assign({ activo: true }, x));
    if (err) { msg.textContent = err; msg.className = 'msg err'; return; }
    b.disabled = true; msg.textContent = 'Guardando…'; msg.className = 'msg';
    try {
      await DB.catGuardar(edicion.tabla, x);
      U.cerrarDialogo($('#dlg-cat'));
      U.toast('Guardado');
      edicion = null;
      render(); U.refrescarCalculo();
    } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; }
    finally { b.disabled = false; }
  }

  // ---------- Imágenes ----------
  /** Reduce la imagen (máx. 1200 px) y la convierte a WebP (o PNG) conservando la transparencia. */
  async function prepararImagen(blob, max) {
    max = max || 1200;
    var bmp = await createImageBitmap(blob);
    var e = Math.min(1, max / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * e)), h = Math.max(1, Math.round(bmp.height * e));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    var out = await new Promise(function (r) { cv.toBlob(r, 'image/webp', 0.9); });
    if (!out || out.type !== 'image/webp') out = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
    if (!out) throw new Error('No se pudo procesar la imagen.');
    return out;
  }
  async function subirDesdeInput(input) {
    var k = input.dataset.subir, file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    var msg = $('#cf-' + (k === 'extra' ? 'extra' : k) + '-msg');
    msg.textContent = 'Subiendo imagen…'; msg.className = 'msg';
    try {
      var ruta = await DB.subirImagen(await prepararImagen(file));
      if (k === 'extra') {
        var s = document.createElement('span');
        s.className = 'extra'; s.dataset.rutaExtra = ruta;
        s.innerHTML = U.imgHTML(ruta, '', 'thumb') + '<button type="button" class="btn btn-chico" data-quitar-extra="' + esc(ruta) + '">Quitar</button>';
        $('#cf-extras').appendChild(s);
      } else {
        $('#cf-' + k).value = ruta;
        $('#cf-' + k + '-vista').innerHTML = U.imgHTML(ruta, '', 'img-grande');
      }
      U.cargarImagenes($('#cat-campos'));
      msg.textContent = 'Imagen cargada. Pulsa Guardar para conservar el cambio.'; msg.className = 'msg ok';
    } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; }
  }

  async function mostrarHistorialItem() {
    if (!edicion || !edicion.fila.id) return;
    var cont = $('#cat-historial');
    cont.innerHTML = '<p class="msg">Cargando…</p>';
    try { cont.innerHTML = htmlAuditoria(await DB.catAuditoria(edicion.fila.id), false); }
    catch (e) { cont.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; }
  }

  // ------------------------------------------------------------------
  // Historial de cambios
  // ------------------------------------------------------------------
  function valTxt(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'activo') return v ? 'Sí' : 'No';
    if (/_id$/.test(k)) { var t = { cliente_id: 'cat_clientes', accesorio_id: 'cat_accesorios', tela_id: 'cat_telas', rubber_id: 'cat_rubbers', proveedor_id: 'cat_proveedores' }[k]; return t ? nombreDe(t, v) : v; }
    if (k === 'tipo_presion') return C.TIPOS_PRESION[v] || v;
    if (k === 'desprendimiento') return NOMBRE_DESP[v] || v;
    if (Array.isArray(v)) return v.length + ' imagen(es)';
    return String(v);
  }
  function htmlAuditoria(lista, conItem) {
    if (!lista.length) return U.vacio('Sin cambios registrados.');
    return '<div class="auditoria">' + lista.map(function (a) {
      var cambios = [];
      if (a.antes && a.despues) {
        Object.keys(a.despues).forEach(function (k) {
          if (SELLO[k]) return;
          if (JSON.stringify(a.antes[k]) !== JSON.stringify(a.despues[k])) cambios.push('<li><b>' + esc(ETQ[k] || k) + ':</b> ' + esc(valTxt(k, a.antes[k])) + ' → ' + esc(valTxt(k, a.despues[k])) + '</li>');
        });
      }
      var item = conItem ? '<div>' + esc((DB.CAT_TABLAS[a.tabla] || {}).nombre || a.tabla) + ': <b>' + esc(etiqueta(a.tabla, a.despues || {})) + '</b></div>' : '';
      return '<article class="aud"><div class="reg-cab"><b>' + (a.accion === 'alta' ? 'Alta' : 'Cambio') + ' · v' + esc(a.version || '') + '</b><span>' + esc(U.fechaHora(a.fecha)) + '</span></div>' +
        item + '<div class="reg-meta">' + esc(a.usuario_email || '') + '</div>' + (cambios.length ? '<ul>' + cambios.join('') + '</ul>' : (a.accion === 'alta' ? '' : '<p class="msg">Sin cambios de valores.</p>')) + '</article>';
    }).join('') + '</div>';
  }
  async function renderHistorial() {
    var p = $('#ad-panel');
    p.innerHTML = '<div class="card"><h3>Cambios del catálogo</h3><p class="ayuda">Quién cambió qué, cuándo, con valores anteriores y nuevos. Los registros de medición guardan su propia copia de los parámetros, así que estos cambios no los alteran.</p><div id="ad-aud"><p class="msg">Cargando…</p></div></div>';
    try { $('#ad-aud').innerHTML = htmlAuditoria(await DB.catAuditoria(null), true); }
    catch (e) { $('#ad-aud').innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; }
  }

  // ------------------------------------------------------------------
  // Importación del Excel
  // ------------------------------------------------------------------
  function renderImportar() {
    var p = $('#ad-panel');
    if (imp && imp.plan) { renderVistaPrevia(); return; }
    p.innerHTML = '<div class="card"><h3>Importar "Parámetros de trims" (.xlsx)</h3>' +
      '<p class="ayuda">Se lee el archivo en este dispositivo y se muestra una vista previa. No se guarda nada hasta que confirmes. ' +
      'Las configuraciones nuevas entran como <b>pendientes de validar</b> y con el tipo de presión <b>pendiente de confirmar</b>. Importar de nuevo el mismo archivo no duplica registros.</p>' +
      '<label class="btn btn-primario btn-grande">Elegir archivo Excel<input type="file" id="imp-archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>' +
      '<p class="msg" id="imp-msg">' + (imp && imp.error ? esc(imp.error) : '') + '</p></div>';
    if (imp && imp.error) $('#imp-msg').className = 'msg err';
    $('#imp-archivo').addEventListener('change', function () { var fl = this.files[0]; this.value = ''; if (fl) leerArchivo(fl); });
  }

  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  async function leerArchivo(file) {
    var msg = $('#imp-msg');
    var paso = function (t) { msg.textContent = t; msg.className = 'msg'; };
    imp = { nombre: file.name };
    try {
      if (!window.DecompressionStream) throw new Error('Este navegador no puede leer archivos .xlsx. Usa Chrome o Edge actualizados.');
      paso('Leyendo el archivo…');
      var libro = await ImportarExcel.leerLibro(await file.arrayBuffer());
      paso('Interpretando las hojas…');
      var ext = ImportarExcel.extraer(libro);
      imp.ext = ext; imp.rutas = {}; imp.blobs = {}; imp.urls = {}; imp.fallidas = [];
      for (var i = 0; i < ext.medios.length; i++) {
        var m = ext.medios[i];
        paso('Procesando imágenes ' + (i + 1) + ' de ' + ext.medios.length + '…');
        var bytes = await libro.zip.bytes(m);
        var tipo = MIME[(m.split('.').pop() || '').toLowerCase()];
        if (!bytes || !tipo) { imp.rutas[m] = null; imp.fallidas.push({ media: m, motivo: 'Formato no admitido (' + m.split('/').pop() + ')' }); continue; }
        var original = new Blob([bytes], { type: tipo });
        imp.urls[m] = URL.createObjectURL(original);
        try {
          var lista = await prepararImagen(original);
          var ruta = await DB.rutaDeImagen(lista);
          imp.rutas[m] = ruta; imp.blobs[ruta] = lista;
        } catch (e) { imp.rutas[m] = null; imp.fallidas.push({ media: m, motivo: 'No se pudo recuperar la imagen: ' + e.message }); }
      }
      imp.plan = ImportarExcel.planificar(ext, imp.rutas, cat(), DB.nuevoId);
      imp.aplicar = {};
      renderVistaPrevia();
    } catch (e) {
      imp = { error: e.message };
      renderImportar();
    }
  }

  function conteo(t, estado) { return imp.plan[t].filter(function (x) { return x.estado === estado; }).length; }
  function nivelCls(n) { return n === 'error' ? 'nivel-error' : n === 'aviso' ? 'nivel-aviso' : 'nivel-info'; }
  function thumbMedia(m) { return m && imp.urls[m] ? '<img class="thumb" src="' + imp.urls[m] + '" alt="">' : '<span class="img-vacia thumb">Sin imagen</span>'; }
  function htmlCambios(it) {
    return '<table class="tabla-cambios"><thead><tr><th>Campo</th><th>Actual</th><th>Excel</th></tr></thead><tbody>' +
      it.cambios.map(function (c) { return '<tr><td>' + esc(ETQ[c.campo] || c.campo) + '</td><td>' + esc(valTxt(c.campo, c.antes)) + '</td><td>' + esc(valTxt(c.campo, c.despues)) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function renderVistaPrevia() {
    var pl = imp.plan, ext = imp.ext;
    var hojas = {};
    ext.filas.forEach(function (r) { hojas[r.hoja.trim()] = (hojas[r.hoja.trim()] || 0) + 1; });
    var nuevos = ['cat_clientes', 'cat_proveedores', 'cat_telas', 'cat_accesorios', 'cat_rubbers', 'cat_configuraciones'].reduce(function (s, t) { return s + conteo(t, 'nuevo'); }, 0);
    var nAvisos = ext.filas.reduce(function (s, r) { return s + r.avisos.filter(function (a) { return a.nivel !== 'info'; }).length; }, 0);
    var h = '<div class="card"><h3>Vista previa: ' + esc(imp.nombre) + '</h3>' +
      '<div class="resumen-total resumen-imp">' +
      '<div><b>' + ext.filas.length + '</b><span>Filas leídas</span></div>' +
      '<div><b>' + conteo('cat_configuraciones', 'nuevo') + '</b><span>Configuraciones nuevas</span></div>' +
      '<div><b>' + conteo('cat_configuraciones', 'cambio') + '</b><span>Con cambios</span></div>' +
      '<div><b>' + conteo('cat_configuraciones', 'igual') + '</b><span>Sin cambios</span></div></div>' +
      '<p class="msg">Hojas importadas: ' + Object.keys(hojas).map(function (k) { return esc(k) + ' (' + hojas[k] + ')'; }).join(', ') + '.</p>' +
      '<p class="msg">Nuevos: ' + conteo('cat_clientes', 'nuevo') + ' clientes · ' + conteo('cat_proveedores', 'nuevo') + ' proveedores · ' + conteo('cat_telas', 'nuevo') + ' telas · ' +
      conteo('cat_accesorios', 'nuevo') + ' referencias · ' + conteo('cat_rubbers', 'nuevo') + ' rubbers. Avisos por revisar: ' + nAvisos + '.</p>';
    var gen = [];
    ext.excluidas.forEach(function (x) { gen.push(['info', 'Hoja "' + x.hoja.trim() + '" excluida: ' + x.motivo + (x.imagenes ? ' (' + x.imagenes + ' imágenes no importadas)' : '')]); });
    ext.generales.forEach(function (x) { gen.push([x.nivel, x.texto]); });
    (pl.unificadas || []).forEach(function (t) { gen.push(['info', t]); });
    pl.duplicados.forEach(function (d) { gen.push(['aviso', d.texto]); });
    imp.fallidas.forEach(function (x) { gen.push(['error', x.media.split('/').pop() + ': ' + x.motivo + '. Puedes cargarla después desde administración.']); });
    if (gen.length) h += '<ul class="avisos-imp">' + gen.map(function (g) { return '<li class="' + nivelCls(g[0]) + '">' + esc(g[1]) + '</li>'; }).join('') + '</ul>';
    h += '</div>';

    // Referencias y rubbers con cambios propuestos
    ['cat_accesorios', 'cat_rubbers'].forEach(function (t) {
      var cambios = pl[t].filter(function (x) { return x.estado === 'cambio'; });
      if (!cambios.length) return;
      h += '<div class="card"><h3>' + esc(DB.CAT_TABLAS[t].nombre) + ' con cambios propuestos</h3>' + cambios.map(function (it) {
        var k = t + ':' + it.fila.id;
        return '<article class="imp-item"><div><b>' + esc(etiqueta(t, it.antes)) + '</b></div>' + htmlCambios(it) +
          '<label class="check"><input type="checkbox" data-aplicar="' + esc(k) + '"' + (imp.aplicar[k] ? ' checked' : '') + '><span>Aplicar estos cambios</span></label></article>';
      }).join('') + '</div>';
    });

    // Configuraciones por cliente
    var grupos = {};
    pl.cat_configuraciones.forEach(function (it) { var c = it.origenFila.cliente; (grupos[c] = grupos[c] || []).push(it); });
    var accPlan = {}; pl.cat_accesorios.forEach(function (x) { accPlan[x.fila.id] = x; });
    var telaPlan = {}; pl.cat_telas.forEach(function (x) { telaPlan[x.fila.id] = x.fila.nombre; });
    Object.keys(grupos).forEach(function (cli) {
      h += '<div class="card"><h3>' + esc(cli) + '</h3><div class="imp-lista">' + grupos[cli].map(function (it) {
        var r = it.origenFila, a = accPlan[it.fila.accesorio_id];
        var est = it.estado === 'nuevo' ? chip('Nueva', 'chip-ok') : it.estado === 'cambio' ? chip('Cambia', 'chip-pend') : chip('Sin cambios', 'chip-gris');
        var avisos = r.avisos.concat((a && a.avisos || []).map(function (t) { return { nivel: 'aviso', texto: t }; }));
        var k = 'cat_configuraciones:' + it.fila.id;
        return '<article class="imp-item"><div class="cat-imgs">' + thumbMedia(r.imagenesRef[0]) + thumbMedia(r.imagenesRub[0]) + '</div><div class="cat-txt">' +
          '<div><b>' + esc(r.codigo) + '</b> ' + est + '</div>' +
          '<div class="reg-meta">' + esc(it.telaNombre || 'Sin tela') + (r.referencia ? ' · ' + esc(r.referencia) : '') + (r.proveedor ? ' · ' + esc(r.proveedor) : '') + '</div>' +
          '<div class="reg-meta">Presión ' + esc(r.presion_texto || '—') + (r.presion_max_psi ? ' → objetivo ' + r.presion_max_psi + ' psi' : '') + ' · ' + esc(it.fila.origen || '') + '</div>' +
          '<details class="det-imp"><summary>Ver detalle' + (avisos.length ? ' y ' + avisos.length + ' aviso' + (avisos.length === 1 ? '' : 's') : '') +
          (avisos.some(function (x) { return x.nivel === 'error'; }) ? ' (hay errores)' : '') + '</summary>' +
          '<dl class="params params-mini">' +
          '<div class="param"><dt>Presión</dt><dd>' + esc(r.presion_texto || '—') + (r.presion_max_psi ? ' → ' + r.presion_min_psi + '–' + r.presion_max_psi + ' psi (objetivo ' + r.presion_max_psi + ')' : '') + '</dd></div>' +
          '<div class="param"><dt>Temperatura</dt><dd>' + esc(r.temperatura_texto || '—') + ' ' + esc(r.temperatura_unidad || '(sin unidad)') + '</dd></div>' +
          '<div class="param"><dt>Tiempo</dt><dd>' + esc(r.tiempo_texto || '—') + '</dd></div>' +
          '<div class="param"><dt>Desprendimiento</dt><dd>' + esc(r.desprendimiento ? NOMBRE_DESP[r.desprendimiento] : '—') + (r.desprendimiento_texto ? ' <small>("' + esc(r.desprendimiento_texto) + '")</small>' : '') + '</dd></div>' +
          (r.observaciones ? '<div class="param"><dt>Observaciones</dt><dd>' + esc(r.observaciones) + '</dd></div>' : '') +
          (r.pruebas_internas ? '<div class="param"><dt>Pruebas internas</dt><dd class="pre">' + esc(r.pruebas_internas) + '</dd></div>' : '') +
          '<div class="param"><dt>Fecha</dt><dd>' + esc(r.fecha || '—') + (r.fecha_texto && r.fecha_texto !== r.fecha ? ' <small>(texto: ' + esc(r.fecha_texto) + ')</small>' : '') + '</dd></div>' +
          '<div class="param"><dt>Origen</dt><dd>' + esc(it.fila.origen || (r.hoja.trim() + ' fila ' + r.fila)) + '</dd></div></dl>' +
          (avisos.length ? '<ul class="avisos-imp">' + avisos.map(function (x) { return '<li class="' + nivelCls(x.nivel) + '">' + esc(x.texto) + '</li>'; }).join('') + '</ul>' : '') + '</details>' +
          (it.estado === 'cambio' ? htmlCambios(it) + (it.reaprobar ? '<p class="msg err">Está aprobada: si aplicas los cambios vuelve a "pendiente de validar".</p>' : '') +
            '<label class="check"><input type="checkbox" data-aplicar="' + esc(k) + '"' + (imp.aplicar[k] ? ' checked' : '') + '><span>Aplicar estos cambios</span></label>' : '') +
          '</div></article>';
      }).join('') + '</div></div>';
    });

    if (ext.sueltas.length) {
      h += '<div class="card"><h3>Imágenes que no se asociaron</h3><p class="ayuda">No están en la columna de referencia ni de rubber de una fila con código. Si alguna corresponde a un accesorio o rubber, descárgala y cárgala desde su ficha.</p><div class="sueltas">' +
        ext.sueltas.map(function (s, i) {
          return '<figure>' + thumbMedia(s.media) + '<figcaption>' + esc(s.hoja.trim()) + ' ' + esc(s.celda) + '<br>' + esc(s.motivo) +
            (imp.urls[s.media] ? '<br><button type="button" class="enlace" data-bajar="' + i + '">Descargar</button>' : '') + '</figcaption></figure>';
        }).join('') + '</div></div>';
    }

    var nCambios = Object.keys(imp.aplicar).filter(function (k) { return imp.aplicar[k]; }).length;
    h += '<div class="card barra-confirmar"><p class="msg" id="imp-msg"></p><div class="acciones">' +
      '<button type="button" class="btn btn-primario btn-grande" id="imp-confirmar"' + (nuevos + nCambios ? '' : ' disabled') + '>Importar ' + nuevos + ' nuevos' + (nCambios ? ' y ' + nCambios + ' cambios' : '') + '</button>' +
      '<button type="button" class="btn" id="imp-cancelar">Cancelar</button></div></div>';
    $('#ad-panel').innerHTML = h;
    $$('[data-aplicar]').forEach(function (c) { c.addEventListener('change', function () { imp.aplicar[c.dataset.aplicar] = c.checked; renderVistaPrevia(); }); });
    $$('[data-bajar]').forEach(function (b) {
      b.addEventListener('click', function () { var s = ext.sueltas[Number(b.dataset.bajar)]; var a = document.createElement('a'); a.href = imp.urls[s.media]; a.download = s.hoja.trim() + '-' + s.celda + '-' + s.media.split('/').pop(); a.click(); });
    });
    $('#imp-confirmar').addEventListener('click', confirmarImportacion);
    $('#imp-cancelar').addEventListener('click', function () { liberar(); imp = null; renderImportar(); });
  }

  function liberar() { if (imp && imp.urls) Object.keys(imp.urls).forEach(function (k) { URL.revokeObjectURL(imp.urls[k]); }); }

  async function confirmarImportacion() {
    var pl = imp.plan, msg = $('#imp-msg'), b = $('#imp-confirmar');
    if (!confirm('¿Importar al catálogo? Las configuraciones nuevas quedan pendientes de validar.')) return;
    b.disabled = true;
    var orden = ['cat_clientes', 'cat_proveedores', 'cat_telas', 'cat_accesorios', 'cat_rubbers', 'cat_configuraciones'];
    var porTabla = {};
    orden.forEach(function (t) {
      porTabla[t] = pl[t].filter(function (it) { return it.estado === 'nuevo' || (it.estado === 'cambio' && imp.aplicar[t + ':' + it.fila.id]); }).map(function (it) { return it.fila; });
    });
    try {
      var rutas = {};
      porTabla.cat_accesorios.concat(porTabla.cat_rubbers).forEach(function (x) { if (x.imagen) rutas[x.imagen] = 1; (x.imagenes_extra || []).forEach(function (r) { rutas[r] = 1; }); });
      var lr = Object.keys(rutas).filter(function (r) { return imp.blobs[r]; });
      for (var i = 0; i < lr.length; i++) { msg.textContent = 'Subiendo imágenes ' + (i + 1) + ' de ' + lr.length + '…'; await DB.subirImagen(imp.blobs[lr[i]]); }
      var total = 0;
      for (var k = 0; k < orden.length; k++) {
        var t = orden[k];
        if (!porTabla[t].length) continue;
        msg.textContent = 'Guardando ' + DB.CAT_TABLAS[t].nombre.toLowerCase() + '…';
        await DB.catGuardar(t, porTabla[t]);
        total += porTabla[t].length;
      }
      liberar();
      imp = null;
      U.toast('Importación terminada: ' + total + ' elementos guardados.');
      tab = 'cat_configuraciones'; filtroConf = 'pendiente';
      render(); U.refrescarCalculo();
    } catch (e) {
      msg.textContent = 'La importación se detuvo: ' + e.message + ' Lo guardado hasta este punto se conserva; puedes volver a importar el archivo sin duplicar.';
      msg.className = 'msg err';
      b.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  var iniciado = false;
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    U = window.AppUI;
    $ = U.$; $$ = U.$$; esc = U.esc; f = U.f; num = U.num;
    $('#ad-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.dataset.tab; render();
    });
    $('#ad-panel').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-editar]');
      if (ed) return abrirForm(tab, ed.dataset.editar);
      var ac = e.target.closest('[data-activo]');
      if (ac) return cambiarActivo(tab, ac.dataset.activo);
      var fl = e.target.closest('[data-filtro]');
      if (fl) { filtroConf = fl.dataset.filtro; renderLista(); }
    });
    $('#form-cat').addEventListener('submit', guardarForm);
    $('#cat-cancelar').addEventListener('click', function () { U.cerrarDialogo($('#dlg-cat')); edicion = null; });
    $('#cat-campos').addEventListener('change', function (e) { if (e.target.matches('[data-subir]')) subirDesdeInput(e.target); });
    $('#cat-campos').addEventListener('click', function (e) {
      var q = e.target.closest('[data-quitar-img]');
      if (q) { var k = q.dataset.quitarImg; $('#cf-' + k).value = ''; $('#cf-' + k + '-vista').innerHTML = U.imgHTML(null); }
      var x = e.target.closest('[data-quitar-extra]');
      if (x) x.closest('.extra').remove();
    });
    $('#cat-historial-box').addEventListener('toggle', function () { if (this.open) mostrarHistorialItem(); });
  }

  window.Admin = { render: render, alCambiarDatos: alCambiarDatos, _prepararImagen: function (b) { return prepararImagen(b); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
