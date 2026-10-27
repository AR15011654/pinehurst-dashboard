/*
 * app.js — Interfaz de Medición Transfer.
 * Los datos se guardan SOLO en el navegador de este dispositivo (localStorage).
 */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  var C = window.Calc;
  var LS_REG = 'transfer.registros.v1';
  var LS_AJ = 'transfer.ajustes.v1';
  var LS_ULT = 'transfer.ultimos.v1';
  var MSG_SIN_CAL = 'No es posible determinar el ajuste del manómetro sin mediciones de esta máquina y este montaje.';

  var NOMBRE_PRES = { psi: 'psi', bar: 'bar', kgfcm2: 'kgf/cm²' };

  // ---------- Utilidades ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function f(v, d) { return C.formatear(v, d === undefined ? 2 : d); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function leerLS(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardarLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('No se pudo guardar en este navegador (' + e.name + '). Exporta tus datos.', true); return false; }
  }
  function hoyISO() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function fechaLegible(iso) { if (!iso) return '—'; var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  var toastTimer;
  function toast(msg, error) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (error ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }

  // ---------- Estado ----------
  var registros = leerLS(LS_REG, []);
  if (!Array.isArray(registros)) registros = [];
  var ajustes = leerLS(LS_AJ, { capValor: null, capUnidad: 'lbf' });
  var ultimos = leerLS(LS_ULT, {});
  var editId = null;
  var grupoSel = null;
  var tablaEqActual = null;

  var DEFAULTS = {
    'f-largo': '4.5', 'f-ancho': '1.1', 'f-psi': '40',
    'p-largo': '4.5', 'p-ancho': '1.1', 'pl-largo': '30', 'pl-ancho': '20',
    'eq-modo': 'lbf', 'eq-inicio': '5', 'eq-fin': '60', 'eq-paso': '5', 's-psi': '40'
  };
  var RECORDAR = Object.keys(DEFAULTS).concat(['p-lectura', 'p-unidad']);

  // ---------- Validación de campos ----------
  /** Lee y valida un campo numérico según data-req. forzar=true muestra "obligatorio" si está vacío. */
  function leer(id, forzar) {
    var el = document.getElementById(id);
    var campo = el.closest('.campo');
    var err = campo ? campo.querySelector('.error') : null;
    var req = el.dataset.req || 'pos';
    var opc = /-opc$/.test(req);
    var txt = el.value.trim();
    var msg = '', v = null;
    if (txt === '') {
      if (!opc && forzar) msg = 'Campo obligatorio.';
    } else {
      var n = C.parseNumero(txt);
      if (isNaN(n)) msg = 'Ingresa un número válido (ej. 4.5).';
      else if ((req === 'pos' || req === 'pos-opc') && !(n > 0)) msg = 'Debe ser mayor que cero.';
      else if (req === 'cero' && n < 0) msg = 'No puede ser negativo.';
      else v = n;
    }
    if (err) err.textContent = msg;
    if (campo) campo.classList.toggle('invalido', !!msg);
    return { ok: !msg && (v !== null || opc), v: v, vacio: txt === '' };
  }

  // ---------- Bloques HTML reutilizables ----------
  function tile(cls, etiqueta, valor, unidad, detalle) {
    return '<div class="res ' + cls + '"><div class="det">' + esc(etiqueta) + '</div>' +
      '<div><span class="val">' + valor + '</span><span class="uni">' + esc(unidad) + '</span></div>' +
      (detalle ? '<div class="det">' + detalle + '</div>' : '') + '</div>';
  }
  function grupo(titulo, contenido) { return '<div class="grupo-res"><h4>' + titulo + '</h4><div class="res-grid">' + contenido + '</div></div>'; }
  function aviso(tipo, titulo, texto) { return '<div class="aviso aviso-' + tipo + '"><b>' + titulo + '</b>' + (texto || '') + '</div>'; }
  function vacio(txt) { return '<p class="vacio">' + esc(txt) + '</p>'; }

  var TXT_PROMEDIO = 'La presión calculada es un promedio estimado. Para que sea representativa, el dinamómetro debe medir la fuerza total que pasa por el área efectiva de contacto del rubber. La presión puede variar entre el centro y las esquinas.';
  var AVISOS_HTML = aviso('alerta', 'Importante sobre la medición',
    '<ul>' +
    '<li>' + TXT_PROMEDIO + '</li>' +
    '<li>El manómetro mide presión del aire; el dinamómetro mide fuerza.</li>' +
    '<li>Confirma la capacidad y temperatura máxima de la celda antes de usarla.</li>' +
    '<li>No utilices los cálculos como ajuste de producción sin validar el montaje y los requisitos del proveedor del logo.</li>' +
    '</ul>');
  var AVISO_PROMEDIO = aviso('info', 'Presión promedio estimada', TXT_PROMEDIO);

  function areaTiles(area) {
    return tile('area', 'Área', f(area.cm2), 'cm²') +
      tile('area', 'Área', f(area.in2), 'in²', 'Valor interno: ' + f(area.in2, 4) + ' in²');
  }
  function fuerzaTiles(fz, etiqueta) {
    return tile('fuerza principal', etiqueta, f(fz.lbf), 'lbf') +
      tile('fuerza', etiqueta, f(fz.kgf), 'kgf') +
      tile('fuerza', etiqueta, f(fz.N), 'N');
  }
  function presionTiles(pr, etiqueta) {
    return tile('presion principal', etiqueta, f(pr.psi), 'psi') +
      tile('presion', etiqueta, f(pr.kgfcm2), 'kgf/cm²') +
      tile('presion', etiqueta, f(pr.bar), 'bar');
  }

  // ---------- Capacidad de la celda ----------
  function capacidadLbf() {
    if (!(ajustes.capValor > 0)) return null;
    try { return C.fuerzaALbf(ajustes.capValor, ajustes.capUnidad); } catch (e) { return null; }
  }
  function textoCapacidad() {
    return ajustes.capValor > 0 ? f(ajustes.capValor) + ' ' + ajustes.capUnidad : 'no verificada';
  }
  function htmlCapacidad(lbf) {
    var cap = capacidadLbf();
    if (cap === null) {
      return aviso('alerta', 'Capacidad de la celda: no verificada', 'Ingresa la capacidad máxima de la celda en Ajustes (botón de engrane) para recibir alertas de sobrecarga.');
    }
    var pct = lbf / cap * 100;
    var capTxt = f(cap) + ' lbf' + (ajustes.capUnidad !== 'lbf' ? ' (' + textoCapacidad() + ')' : '');
    if (lbf >= cap) {
      return aviso('peligro', 'ATENCIÓN: la fuerza alcanza o supera la capacidad de la celda',
        'Fuerza ' + f(lbf) + ' lbf ≥ capacidad ' + capTxt + ' — ' + f(pct, 0) + ' %. No apliques esta carga a la celda.');
    }
    if (pct >= 90) return aviso('alerta', 'Cerca de la capacidad de la celda', 'Fuerza al ' + f(pct, 0) + ' % de la capacidad (' + capTxt + ').');
    return aviso('ok', 'Dentro de la capacidad de la celda', 'Fuerza al ' + f(pct, 0) + ' % de la capacidad (' + capTxt + ').');
  }

  // ---------- Compartir / descargar ----------
  function descargar(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function compartirTexto(titulo, texto) {
    if (navigator.share) {
      navigator.share({ title: titulo, text: texto }).catch(function (e) { if (e && e.name !== 'AbortError') copiar(texto); });
    } else copiar(texto);
  }
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { toast('Resultado copiado. Pégalo en tu mensaje o correo.'); },
        function () { toast('No se pudo copiar el resultado.', true); });
    } else toast('Este navegador no permite compartir ni copiar automáticamente.', true);
  }
  function compartirArchivo(blob, nombre, titulo) {
    var file;
    try { file = new File([blob], nombre, { type: blob.type }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: titulo }).catch(function (e) {
        if (e && e.name !== 'AbortError') { descargar(blob, nombre); }
      });
    } else {
      descargar(blob, nombre);
      toast('Este dispositivo no permite compartir archivos; se descargó el archivo.');
    }
  }

  // ---------- Navegación ----------
  var VISTAS = ['v-fuerza', 'v-presion', 'v-calibracion', 'v-historial'];
  function mostrarVista(id, sinScroll) {
    if (VISTAS.indexOf(id) < 0) id = 'v-fuerza';
    $$('.vista').forEach(function (v) { v.hidden = v.id !== id; });
    $$('.nav-btn').forEach(function (b) { b.setAttribute('aria-current', b.dataset.vista === id ? 'page' : 'false'); });
    try { history.replaceState(null, '', '#' + id.slice(2)); } catch (e) { /* sin historial */ }
    if (id === 'v-calibracion') renderCalibracion();
    if (id === 'v-historial') renderHistorial();
    if (!sinScroll) window.scrollTo(0, 0);
  }

  // ---------- Recordar últimos valores ----------
  function restaurarCampos() {
    RECORDAR.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var v = ultimos[id] !== undefined ? ultimos[id] : DEFAULTS[id];
      if (v !== undefined) el.value = v;
    });
  }
  function recordar(id) {
    var el = document.getElementById(id);
    if (!el || RECORDAR.indexOf(id) < 0) return;
    ultimos[id] = el.value;
    guardarLS(LS_ULT, ultimos);
  }

  // ======================================================
  // 1. FUERZA NECESARIA
  // ======================================================
  var ultimoFuerza = null;
  function calcFuerza() {
    var l = leer('f-largo'), a = leer('f-ancho'), p = leer('f-psi');
    $('#eq-rubber').textContent = l.ok && a.ok ? f(l.v) + ' × ' + f(a.v) + ' cm' : 'ingresa largo y ancho';
    if (!(l.ok && a.ok && p.ok)) {
      ultimoFuerza = null;
      $('#f-resultados').innerHTML = vacio('Ingresa largo, ancho y presión deseada (números mayores que cero).');
      $('#f-capacidad').innerHTML = '';
      return;
    }
    var r = C.fuerzaNecesaria(l.v, a.v, p.v);
    ultimoFuerza = { l: l.v, a: a.v, p: p.v, r: r };
    $('#f-resultados').innerHTML =
      grupo('Área del rubber', areaTiles(r.area)) +
      grupo('<span class="tag tag-fuerza">Fuerza necesaria</span> (lectura objetivo del dinamómetro)', fuerzaTiles(r.fuerza, 'Fuerza')) +
      grupo('<span class="tag tag-presion">Presión promedio deseada</span> sobre el rubber', presionTiles(r.presion, 'Presión')) +
      AVISO_PROMEDIO;
    $('#f-capacidad').innerHTML = htmlCapacidad(r.fuerza.lbf);
  }

  function compartirFuerza() {
    if (!ultimoFuerza) { toast('Completa los datos primero.', true); return; }
    var u = ultimoFuerza, r = u.r;
    compartirTexto('Fuerza necesaria', [
      'FUERZA NECESARIA — Medición Transfer',
      'Rubber: ' + f(u.l) + ' × ' + f(u.a) + ' cm (' + f(r.area.cm2) + ' cm² / ' + f(r.area.in2, 4) + ' in²)',
      'Presión promedio deseada sobre el rubber: ' + f(u.p) + ' psi (' + f(r.presion.kgfcm2) + ' kgf/cm², ' + f(r.presion.bar) + ' bar)',
      'Fuerza necesaria: ' + f(r.fuerza.lbf) + ' lbf = ' + f(r.fuerza.kgf) + ' kgf = ' + f(r.fuerza.N) + ' N',
      'Capacidad de la celda: ' + textoCapacidad(),
      'Nota: presión promedio estimada; no es la presión del aire del manómetro.'
    ].join('\n'));
  }

  // ---------- Tabla de equivalencias ----------
  function actualizarUnidadEq() {
    var u = $('#eq-modo').value === 'psi' ? 'psi' : 'lbf';
    $$('.eq-u').forEach(function (s) { s.textContent = u; });
  }
  function generarTabla(silencioso) {
    var msg = $('#eq-msg');
    msg.className = 'msg';
    var l = leer('f-largo', !silencioso), a = leer('f-ancho', !silencioso);
    var i = leer('eq-inicio', !silencioso), fi = leer('eq-fin', !silencioso), pa = leer('eq-paso', !silencioso);
    var modo = $('#eq-modo').value;
    if (!(l.ok && a.ok)) { if (!silencioso) { msg.textContent = 'Ingresa el largo y ancho del rubber arriba.'; msg.className = 'msg err'; } return; }
    if (!(i.ok && fi.ok && pa.ok)) { if (!silencioso) { msg.textContent = 'Revisa los valores inicial, final e incremento.'; msg.className = 'msg err'; } return; }
    if (fi.v < i.v) { msg.textContent = 'El valor final debe ser mayor o igual que el inicial.'; msg.className = 'msg err'; return; }
    var area = C.areaRect(l.v, a.v);
    var filas;
    try { filas = C.tablaEquivalencias(modo, i.v, fi.v, pa.v, area.in2, 500); }
    catch (e) { msg.textContent = e.message; msg.className = 'msg err'; return; }
    var cap = capacidadLbf();
    tablaEqActual = { modo: modo, largo: l.v, ancho: a.v, area: area, filas: filas };
    var cab = modo === 'psi'
      ? '<th class="c-presion">Presión deseada<br>psi</th><th class="c-fuerza">Fuerza<br>lbf</th><th class="c-fuerza">Fuerza<br>kgf</th><th class="c-fuerza">Fuerza<br>N</th>'
      : '<th class="c-fuerza">Fuerza<br>lbf</th><th class="c-fuerza">Fuerza<br>kgf</th><th class="c-fuerza">Fuerza<br>N</th><th class="c-presion">Presión prom.<br>psi</th>';
    var cuerpo = filas.map(function (r) {
      var sobre = cap !== null && r.lbf >= cap ? ' style="color:var(--peligro);font-weight:700"' : '';
      var celdas = modo === 'psi'
        ? '<td>' + f(r.psi) + '</td><td' + sobre + '>' + f(r.lbf) + '</td><td>' + f(r.kgf) + '</td><td>' + f(r.N) + '</td>'
        : '<td' + sobre + '>' + f(r.lbf) + '</td><td>' + f(r.kgf) + '</td><td>' + f(r.N) + '</td><td>' + f(r.psi) + '</td>';
      return '<tr>' + celdas + '</tr>';
    }).join('');
    $('#eq-tabla').innerHTML = '<table><thead><tr>' + cab + '</tr></thead><tbody>' + cuerpo + '</tbody></table>';
    msg.textContent = filas.length + ' filas · rubber ' + f(l.v) + ' × ' + f(a.v) + ' cm (' + f(area.in2, 4) + ' in²)' +
      (cap !== null ? ' · en rojo: fuerza ≥ capacidad de la celda' : ' · capacidad de la celda no verificada');
    $('#eq-csv').disabled = false; $('#eq-xlsx').disabled = false;
  }
  function filasTablaEq() {
    var t = tablaEqActual;
    var cab = t.modo === 'psi'
      ? ['Presión deseada (psi)', 'Fuerza (lbf)', 'Fuerza (kgf)', 'Fuerza (N)']
      : ['Fuerza (lbf)', 'Fuerza (kgf)', 'Fuerza (N)', 'Presión promedio rubber (psi)'];
    var filas = [cab];
    t.filas.forEach(function (r) {
      var v = t.modo === 'psi' ? [r.psi, r.lbf, r.kgf, r.N] : [r.lbf, r.kgf, r.N, r.psi];
      filas.push(v.map(function (x) { return C.redondear(x, 2); }));
    });
    return filas;
  }
  function nombreTablaEq(ext) {
    var t = tablaEqActual;
    return 'equivalencias-rubber-' + C.redondear(t.largo, 2) + 'x' + C.redondear(t.ancho, 2) + 'cm-' + t.modo + '.' + ext;
  }

  // ======================================================
  // 2. PRESIÓN MEDIDA
  // ======================================================
  var ultimoPresion = null;
  function calcPresion() {
    var l = leer('p-largo'), a = leer('p-ancho'), x = leer('p-lectura');
    var u = $('#p-unidad').value;
    if (!(l.ok && a.ok && x.ok)) {
      ultimoPresion = null;
      $('#p-resultados').innerHTML = vacio('Ingresa largo, ancho y la lectura del dinamómetro (números mayores que cero).');
      $('#p-capacidad').innerHTML = '';
    } else {
      var r = C.presionMedida(l.v, a.v, x.v, u);
      ultimoPresion = { l: l.v, a: a.v, x: x.v, u: u, r: r };
      $('#p-resultados').innerHTML =
        grupo('Área del rubber', areaTiles(r.area)) +
        grupo('<span class="tag tag-fuerza">Fuerza medida</span> (dinamómetro)', fuerzaTiles(r.fuerza, 'Fuerza')) +
        grupo('<span class="tag tag-presion">Presión promedio estimada</span> sobre el rubber', presionTiles(r.presion, 'Presión')) +
        AVISO_PROMEDIO;
      $('#p-capacidad').innerHTML = htmlCapacidad(r.fuerza.lbf);
    }
    calcPlancha();
  }

  function calcPlancha() {
    var l = leer('pl-largo'), a = leer('pl-ancho');
    var total = $('#pl-total').checked;
    var out = $('#pl-resultados');
    if (!(l.ok && a.ok) || l.vacio || a.vacio) {
      out.innerHTML = vacio('Ingresa largo y ancho de la plancha para ver su área.');
      return;
    }
    var area = C.areaRect(l.v, a.v);
    var html = grupo('Área de la plancha', areaTiles(area));
    if (!total) {
      html += aviso('info', 'Presión sobre la plancha: no calculada', 'Marca la casilla solo si la fuerza medida corresponde a toda la fuerza aplicada sobre la plancha completa. No se asume que toda la plancha esté en contacto en producción.');
    } else if (!ultimoPresion) {
      html += vacio('Ingresa la lectura del dinamómetro arriba.');
    } else {
      var lbf = ultimoPresion.r.fuerza.lbf;
      html += grupo('<span class="tag tag-presion">Presión promedio sobre la plancha completa</span>', presionTiles(C.presionDesdePsi(lbf / area.in2), 'Plancha')) +
        aviso('alerta', 'Resultado distinto al del rubber', 'Este valor reparte la fuerza en toda la plancha (' + f(area.cm2) + ' cm²). La presión sobre el logo se calcula con el área del rubber, arriba.');
    }
    out.innerHTML = html;
  }

  function compartirPresion() {
    if (!ultimoPresion) { toast('Completa los datos primero.', true); return; }
    var u = ultimoPresion, r = u.r;
    compartirTexto('Presión medida', [
      'PRESIÓN MEDIDA — Medición Transfer',
      'Rubber: ' + f(u.l) + ' × ' + f(u.a) + ' cm (' + f(r.area.cm2) + ' cm² / ' + f(r.area.in2, 4) + ' in²)',
      'Lectura del dinamómetro: ' + f(u.x) + ' ' + u.u + ' = ' + f(r.fuerza.lbf) + ' lbf = ' + f(r.fuerza.kgf) + ' kgf = ' + f(r.fuerza.N) + ' N',
      'Presión promedio estimada sobre el rubber: ' + f(r.presion.psi) + ' psi = ' + f(r.presion.kgfcm2) + ' kgf/cm² = ' + f(r.presion.bar) + ' bar',
      'Capacidad de la celda: ' + textoCapacidad(),
      'Nota: presión promedio estimada; puede variar entre el centro y las esquinas. No es la presión del aire del manómetro.'
    ].join('\n'));
  }

  function presionARegistro() {
    if (!ultimoPresion) { toast('Completa los datos primero.', true); return; }
    cancelarEdicion();
    $('#c-largo').value = String(ultimoPresion.l);
    $('#c-ancho').value = String(ultimoPresion.a);
    $('#c-fuerza').value = String(ultimoPresion.x);
    $('#c-fuerza-u').value = ultimoPresion.u;
    mostrarVista('v-calibracion');
    previewRegistro();
    $('#c-maquina').focus();
    toast('Completa máquina y presión del manómetro, luego guarda.');
  }

  // ======================================================
  // 3. CALIBRACIÓN — registro
  // ======================================================
  function derivados(reg) {
    var area = C.areaRect(reg.largo, reg.ancho);
    var lbf = C.fuerzaALbf(reg.fuerzaValor, reg.fuerzaUnidad);
    return {
      area: area,
      fuerza: C.fuerzaDesdeLbf(lbf),
      presion: C.presionDesdePsi(lbf / area.in2),
      manPsi: C.presionAPsi(reg.manValor, reg.manUnidad)
    };
  }

  function previewRegistro() {
    var l = leer('c-largo'), a = leer('c-ancho'), fz = leer('c-fuerza'), m = leer('c-man');
    var out = $('#c-preview');
    if (!(l.ok && a.ok && fz.ok)) { out.innerHTML = vacio('La presión promedio sobre el rubber se calcula al ingresar rubber y fuerza.'); return; }
    var r = C.presionMedida(l.v, a.v, fz.v, $('#c-fuerza-u').value);
    var html = '<div class="res-grid">';
    if (m.ok) html += tile('aire', 'Manómetro (aire)', f(m.v), NOMBRE_PRES[$('#c-man-u').value]);
    html += tile('fuerza', 'Fuerza medida', f(r.fuerza.lbf), 'lbf') +
      tile('presion', 'Presión prom. rubber', f(r.presion.psi), 'psi', f(r.presion.kgfcm2) + ' kgf/cm² · ' + f(r.presion.bar) + ' bar') + '</div>';
    html += htmlCapacidad(r.fuerza.lbf);
    out.innerHTML = html;
  }

  function guardarRegistro(ev) {
    ev.preventDefault();
    var msg = $('#c-msg');
    var maquina = $('#c-maquina').value.trim();
    var fecha = $('#c-fecha').value;
    var errM = $('#c-maquina').closest('.campo').querySelector('.error');
    var errF = $('#c-fecha').closest('.campo').querySelector('.error');
    errM.textContent = maquina ? '' : 'Indica la máquina.';
    errF.textContent = fecha ? '' : 'Indica la fecha.';
    $('#c-maquina').closest('.campo').classList.toggle('invalido', !maquina);
    $('#c-fecha').closest('.campo').classList.toggle('invalido', !fecha);
    var campos = {
      largo: leer('c-largo', true), ancho: leer('c-ancho', true), man: leer('c-man', true),
      fuerza: leer('c-fuerza', true), temp: leer('c-temp', true), tiempo: leer('c-tiempo', true)
    };
    var ok = maquina && fecha && Object.keys(campos).every(function (k) { return campos[k].ok; });
    if (!ok) {
      msg.textContent = 'Revisa los campos marcados en rojo.'; msg.className = 'msg err';
      var primero = $('.campo.invalido input, .campo.invalido select', $('#form-registro'));
      if (primero) primero.focus();
      return;
    }
    var reg = {
      id: editId || nuevoId(),
      maquina: maquina,
      montaje: $('#c-montaje').value.trim(),
      fecha: fecha,
      largo: campos.largo.v, ancho: campos.ancho.v,
      manValor: campos.man.v, manUnidad: $('#c-man-u').value,
      fuerzaValor: campos.fuerza.v, fuerzaUnidad: $('#c-fuerza-u').value,
      temp: campos.temp.v, tempUnidad: $('#c-temp-u').value,
      tiempo: campos.tiempo.v,
      obs: $('#c-obs').value.trim()
    };
    reg.presionPsi = derivados(reg).presion.psi; // se guarda también para exportar
    var ahora = new Date().toISOString();
    if (editId) {
      var idx = registros.findIndex(function (r) { return r.id === editId; });
      if (idx >= 0) { reg.creado = registros[idx].creado; reg.modificado = ahora; registros[idx] = reg; }
      else { reg.creado = ahora; registros.push(reg); }
    } else { reg.creado = ahora; registros.push(reg); }
    if (!guardarLS(LS_REG, registros)) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var eraEdicion = !!editId;
    grupoSel = C.claveGrupo(reg);
    cancelarEdicion(true);
    // Mantener máquina, montaje, rubber y unidades para la siguiente prueba; limpiar lecturas
    $('#c-maquina').value = reg.maquina; $('#c-montaje').value = reg.montaje;
    $('#c-largo').value = String(reg.largo); $('#c-ancho').value = String(reg.ancho);
    $('#c-man-u').value = reg.manUnidad; $('#c-fuerza-u').value = reg.fuerzaUnidad;
    $('#c-fecha').value = reg.fecha;
    msg.textContent = eraEdicion ? 'Registro actualizado.' : 'Prueba guardada. Ingresa la siguiente con otro ajuste del manómetro.';
    msg.className = 'msg ok';
    toast(eraEdicion ? 'Registro actualizado' : 'Prueba guardada');
    previewRegistro();
    renderCalibracion();
  }

  function limpiarFormulario(mantenerMsg) {
    ['c-maquina', 'c-montaje', 'c-largo', 'c-ancho', 'c-man', 'c-fuerza', 'c-temp', 'c-tiempo', 'c-obs'].forEach(function (id) { $('#' + id).value = ''; });
    $('#c-fecha').value = hoyISO();
    $$('#form-registro .campo').forEach(function (c) { c.classList.remove('invalido'); var e = c.querySelector('.error'); if (e) e.textContent = ''; });
    if (!mantenerMsg) $('#c-msg').textContent = '';
    previewRegistro();
  }
  function cancelarEdicion(mantenerMsg) {
    editId = null;
    $('#reg-titulo').textContent = 'Nueva prueba';
    $('#c-guardar').textContent = 'Guardar prueba';
    $('#c-cancelar').hidden = true;
    limpiarFormulario(mantenerMsg);
  }
  function editarRegistro(id) {
    var r = registros.find(function (x) { return x.id === id; });
    if (!r) return;
    editId = id;
    $('#c-maquina').value = r.maquina; $('#c-montaje').value = r.montaje || '';
    $('#c-fecha').value = r.fecha || hoyISO();
    $('#c-largo').value = String(r.largo); $('#c-ancho').value = String(r.ancho);
    $('#c-man').value = String(r.manValor); $('#c-man-u').value = r.manUnidad;
    $('#c-fuerza').value = String(r.fuerzaValor); $('#c-fuerza-u').value = r.fuerzaUnidad;
    $('#c-temp').value = r.temp === null || r.temp === undefined ? '' : String(r.temp);
    $('#c-temp-u').value = r.tempUnidad || '°C';
    $('#c-tiempo').value = r.tiempo === null || r.tiempo === undefined ? '' : String(r.tiempo);
    $('#c-obs').value = r.obs || '';
    $('#reg-titulo').textContent = 'Editar prueba';
    $('#c-guardar').textContent = 'Guardar cambios';
    $('#c-cancelar').hidden = false;
    $('#c-msg').textContent = '';
    mostrarVista('v-calibracion');
    previewRegistro();
    $('#form-registro').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function eliminarRegistro(id) {
    var r = registros.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!confirm('¿Eliminar la prueba de "' + r.maquina + '" del ' + fechaLegible(r.fecha) + '? Esta acción no se puede deshacer.')) return;
    registros = registros.filter(function (x) { return x.id !== id; });
    guardarLS(LS_REG, registros);
    if (editId === id) cancelarEdicion();
    toast('Registro eliminado');
    renderHistorial();
    renderCalibracion();
  }

  function actualizarListas() {
    var maqs = {}, monts = {};
    registros.forEach(function (r) { maqs[r.maquina] = 1; if (r.montaje) monts[r.montaje] = 1; });
    $('#lista-maquinas').innerHTML = Object.keys(maqs).sort().map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
    $('#lista-montajes').innerHTML = Object.keys(monts).sort().map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
  }

  // ---------- Grupos de calibración ----------
  function grupos() {
    var g = {};
    registros.forEach(function (r) {
      var k = C.claveGrupo(r);
      if (!g[k]) g[k] = { clave: k, maquina: r.maquina, montaje: r.montaje, largo: r.largo, ancho: r.ancho, regs: [] };
      g[k].regs.push(r);
    });
    return g;
  }
  function etiquetaGrupo(g) {
    return g.maquina + ' · ' + f(g.largo) + '×' + f(g.ancho) + ' cm · ' + (g.montaje ? g.montaje : 'montaje sin especificar') + ' (' + g.regs.length + ')';
  }

  // ---------- Gráficas SVG ----------
  function pasoBonito(rango, n) {
    var bruto = rango / n;
    var mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    var r = bruto / mag;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  }
  function graficaSVG(titulo, puntos, op) {
    var W = 600, H = 330, ml = 62, mr = 18, mt = 16, mb = 50;
    var xmax = Math.max.apply(null, puntos.map(function (p) { return p.x; })) || 1;
    var ymax = Math.max.apply(null, puntos.map(function (p) { return p.y; })) || 1;
    var sx = pasoBonito(xmax * 1.1, 5), sy = pasoBonito(ymax * 1.1, 5);
    xmax = Math.ceil(xmax * 1.1 / sx) * sx; ymax = Math.ceil(ymax * 1.1 / sy) * sy;
    var X = function (v) { return ml + v / xmax * (W - ml - mr); };
    var Y = function (v) { return H - mb - v / ymax * (H - mt - mb); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titulo) + '">';
    for (var gx = 0; gx <= xmax + 1e-9; gx += sx) {
      s += '<line class="rejilla" x1="' + X(gx) + '" x2="' + X(gx) + '" y1="' + mt + '" y2="' + (H - mb) + '"/>' +
        '<text x="' + X(gx) + '" y="' + (H - mb + 18) + '" text-anchor="middle">' + C.redondear(gx, 2) + '</text>';
    }
    for (var gy = 0; gy <= ymax + 1e-9; gy += sy) {
      s += '<line class="rejilla" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(gy) + '" y2="' + Y(gy) + '"/>' +
        '<text x="' + (ml - 8) + '" y="' + (Y(gy) + 4) + '" text-anchor="end">' + C.redondear(gy, 2) + '</text>';
    }
    s += '<line class="eje" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (H - mb) + '" y2="' + (H - mb) + '"/>' +
      '<line class="eje" x1="' + ml + '" x2="' + ml + '" y1="' + mt + '" y2="' + (H - mb) + '"/>';
    s += '<text x="' + ((W + ml) / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(op.xLab) + '</text>' +
      '<text transform="translate(16 ' + ((H - mb + mt) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(op.yLab) + '</text>';
    if (op.reg) {
      var x1 = op.reg.xmin, x2 = op.reg.xmax;
      s += '<line x1="' + X(x1) + '" y1="' + Y(op.reg.m * x1 + op.reg.b) + '" x2="' + X(x2) + '" y2="' + Y(op.reg.m * x2 + op.reg.b) + '" stroke="' + op.color + '" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>';
    }
    puntos.forEach(function (p) {
      s += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="7" fill="' + op.color + '" stroke="#fff" stroke-width="2"><title>' +
        C.redondear(p.x, 2) + ' → ' + C.redondear(p.y, 2) + '</title></circle>';
    });
    return '<div class="grafica"><h4>' + esc(titulo) + '</h4>' + s + '</svg></div>';
  }

  function colorVar(nombre) { return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || '#0b6bb5'; }

  function graficasGrupo(g) {
    var pts = g.regs.map(function (r) { var d = derivados(r); return { x: d.manPsi, f: d.fuerza.lbf, p: d.presion.psi }; });
    var reg = C.regresionLineal(pts.map(function (p) { return { x: p.x, y: p.f }; }));
    var regP = C.regresionLineal(pts.map(function (p) { return { x: p.x, y: p.p }; }));
    var xs = pts.map(function (p) { return p.x; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    return graficaSVG('Fuerza medida vs. presión del manómetro', pts.map(function (p) { return { x: p.x, y: p.f }; }),
        { xLab: 'Presión del manómetro (aire), psi', yLab: 'Fuerza medida, lbf', color: colorVar('--fuerza'), reg: reg && reg.m > 0 ? { m: reg.m, b: reg.b, xmin: xmin, xmax: xmax } : null }) +
      graficaSVG('Presión promedio en el rubber vs. presión del manómetro', pts.map(function (p) { return { x: p.x, y: p.p }; }),
        { xLab: 'Presión del manómetro (aire), psi', yLab: 'Presión prom. rubber, psi', color: colorVar('--presion'), reg: regP && regP.m > 0 ? { m: regP.m, b: regP.b, xmin: xmin, xmax: xmax } : null });
  }

  function renderCalibracion() {
    actualizarListas();
    var gs = grupos();
    var claves = Object.keys(gs);
    var sel = $('#g-grupo');
    if (!claves.length) {
      sel.innerHTML = '<option value="">Sin registros todavía</option>';
      sel.disabled = true;
      $('#g-graficas').innerHTML = vacio('Guarda pruebas para ver la gráfica de esta máquina.');
      $('#g-tabla').innerHTML = '';
      renderSugerencia();
      return;
    }
    sel.disabled = false;
    if (!grupoSel || !gs[grupoSel]) grupoSel = C.claveGrupo(registros[registros.length - 1]);
    sel.innerHTML = claves.sort().map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === grupoSel ? ' selected' : '') + '>' + esc(etiquetaGrupo(gs[k])) + '</option>';
    }).join('');
    var g = gs[grupoSel];
    $('#g-graficas').innerHTML = graficasGrupo(g) +
      '<p class="ayuda">Cada punto es una prueba. La línea punteada es el ajuste lineal de los datos medidos y solo se dibuja dentro del rango medido.</p>';
    var filas = g.regs.slice().sort(function (a, b) { return derivados(a).manPsi - derivados(b).manPsi; }).map(function (r) {
      var d = derivados(r);
      return '<tr><td class="txt">' + fechaLegible(r.fecha) + '</td><td>' + f(r.manValor) + ' ' + NOMBRE_PRES[r.manUnidad] + '</td><td>' + f(d.manPsi) +
        '</td><td>' + f(d.fuerza.lbf) + '</td><td>' + f(d.fuerza.kgf) + '</td><td>' + f(d.presion.psi) + '</td></tr>';
    }).join('');
    $('#g-tabla').innerHTML = '<table><thead><tr><th class="txt">Fecha</th><th class="c-aire">Manómetro</th><th class="c-aire">Manóm. psi</th>' +
      '<th class="c-fuerza">Fuerza lbf</th><th class="c-fuerza">Fuerza kgf</th><th class="c-presion">Pres. rubber psi</th></tr></thead><tbody>' + filas + '</tbody></table>';
    renderSugerencia();
  }

  function renderSugerencia() {
    var out = $('#s-resultado');
    var p = leer('s-psi');
    var gs = grupos();
    var g = grupoSel ? gs[grupoSel] : null;
    if (!g) { out.innerHTML = aviso('info', MSG_SIN_CAL, 'Registra al menos 2 pruebas de la misma máquina, rubber y montaje con distintas presiones de manómetro.'); return; }
    if (!p.ok) { out.innerHTML = vacio('Ingresa la presión deseada sobre el rubber.'); return; }
    var area = C.areaRect(g.largo, g.ancho);
    var objetivo = p.v * area.in2;
    var pts = g.regs.map(function (r) { var d = derivados(r); return { manPsi: d.manPsi, fuerzaLbf: d.fuerza.lbf }; });
    var s = C.sugerirManometro(pts, objetivo);
    var cab = '<p>Para <b>' + f(p.v) + ' psi</b> promedio sobre el rubber de ' + f(g.largo) + ' × ' + f(g.ancho) + ' cm se necesita una fuerza de <b>' +
      f(objetivo) + ' lbf</b> (' + f(objetivo / C.K.LB_POR_KG) + ' kgf · ' + f(objetivo * C.K.N_POR_LBF) + ' N).</p>';
    if (!s.ok) { out.innerHTML = cab + aviso('info', MSG_SIN_CAL, esc(s.detalle)); return; }
    var unidades = {};
    g.regs.forEach(function (r) { unidades[r.manUnidad] = (unidades[r.manUnidad] || 0) + 1; });
    var uPrinc = Object.keys(unidades).sort(function (a, b) { return unidades[b] - unidades[a]; })[0];
    var valPrinc = uPrinc === 'psi' ? s.man.psi : uPrinc === 'bar' ? s.man.bar : s.man.kgfcm2;
    var html = cab + '<div class="estimacion"><span class="etiqueta">ESTIMACIÓN</span>' +
      '<p style="margin:8px 0 6px">Ajuste aproximado del <span class="tag tag-aire">manómetro</span> para <b>' + esc(g.maquina) + '</b>:</p>' +
      '<div class="res-grid">' + tile('aire principal', 'Manómetro', f(valPrinc), NOMBRE_PRES[uPrinc]) +
      (uPrinc !== 'psi' ? tile('aire', 'Manómetro', f(s.man.psi), 'psi') : '') +
      (uPrinc !== 'bar' ? tile('aire', 'Manómetro', f(s.man.bar), 'bar') : '') +
      (uPrinc !== 'kgfcm2' ? tile('aire', 'Manómetro', f(s.man.kgfcm2), 'kgf/cm²') : '') + '</div>' +
      '<p class="ayuda" style="margin-top:10px">Debe comprobarse con una nueva medición con el dinamómetro antes de usarse. Basado en ' + s.n + ' pruebas de esta máquina, rubber y montaje; rango medido ' +
      f(s.xmin) + '–' + f(s.xmax) + ' psi de manómetro; R² = ' + f(s.r2, 3) + '.</p></div>';
    if (s.extrapola) html += aviso('peligro', 'Fuera del rango medido', 'El ajuste estimado está fuera de las presiones de manómetro que se midieron. La estimación no es confiable: mide nuevas pruebas cerca de este valor.');
    if (s.r2 < 0.95 && s.n >= 3) html += aviso('alerta', 'Datos dispersos', 'Las mediciones no siguen bien una línea (R² = ' + f(s.r2, 3) + '). Revisa repetibilidad, posición de la celda y estabilidad de la lectura.');
    html += htmlCapacidad(objetivo);
    out.innerHTML = html;
  }

  // ======================================================
  // 4. HISTORIAL Y REPORTES
  // ======================================================
  function registrosFiltrados() {
    var maq = $('#h-maquina').value;
    var q = $('#h-buscar').value.trim().toLowerCase();
    return registros.filter(function (r) {
      if (maq && r.maquina !== maq) return false;
      if (q && (r.maquina + ' ' + (r.montaje || '') + ' ' + (r.obs || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''); });
  }

  function renderHistorial() {
    actualizarListas();
    var sel = $('#h-maquina');
    var actual = sel.value;
    var maqs = {};
    registros.forEach(function (r) { maqs[r.maquina] = 1; });
    sel.innerHTML = '<option value="">Todas las máquinas</option>' + Object.keys(maqs).sort().map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === actual ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
    var lista = registrosFiltrados();
    $('#h-conteo').textContent = lista.length + ' de ' + registros.length + ' registros.';
    if (!lista.length) {
      $('#h-tabla').innerHTML = vacio(registros.length ? 'Ningún registro coincide con el filtro.' : 'Aún no hay pruebas registradas. Regístralas en la sección 3. Calibración.');
    } else {
      var tarjetas = lista.map(function (r) {
        var d = derivados(r);
        return '<article class="reg"><div class="reg-cab"><b>' + esc(r.maquina) + '</b><span>' + fechaLegible(r.fecha) + '</span></div>' +
          '<div class="reg-meta">Rubber ' + f(r.largo) + ' × ' + f(r.ancho) + ' cm' + (r.montaje ? ' · ' + esc(r.montaje) : '') + '</div>' +
          '<div class="reg-vals">' +
          '<div class="tag-aire">Manómetro<strong>' + f(r.manValor) + ' ' + NOMBRE_PRES[r.manUnidad] + '</strong></div>' +
          '<div class="tag-fuerza">Fuerza<strong>' + f(r.fuerzaValor) + ' ' + esc(r.fuerzaUnidad) + '</strong></div>' +
          '<div class="tag-presion">Pres. rubber<strong>' + f(d.presion.psi) + ' psi</strong></div></div>' +
          '<div class="reg-meta">' + (r.temp !== null && r.temp !== undefined ? 'Temp. ' + f(r.temp, 1) + ' ' + esc(r.tempUnidad) + ' · ' : '') +
          (r.tiempo ? 'Tiempo ' + f(r.tiempo, 1) + ' s' : '') + (r.obs ? '<br>' + esc(r.obs) : '') + '</div>' +
          '<div class="acciones"><button class="btn btn-chico" data-acc="editar" data-id="' + esc(r.id) + '">Editar</button>' +
          '<button class="btn btn-chico btn-peligro" data-acc="eliminar" data-id="' + esc(r.id) + '">Eliminar</button></div></article>';
      }).join('');
      $('#h-tabla').innerHTML = '<div class="reg-lista">' + tarjetas + '</div><div class="tabla-historial">' + tablaHistorialHTML(lista, true) + '</div>';
    }
    renderRubbers();
  }

  function tablaHistorialHTML(lista, conAcciones) {
    var filas = lista.map(function (r) {
      var d = derivados(r);
      return '<tr><td class="txt">' + fechaLegible(r.fecha) + '</td><td class="txt">' + esc(r.maquina) + '</td><td class="txt">' + esc(r.montaje || '—') + '</td>' +
        '<td>' + f(r.largo) + ' × ' + f(r.ancho) + '</td>' +
        '<td>' + f(r.manValor) + ' ' + NOMBRE_PRES[r.manUnidad] + '</td>' +
        '<td>' + f(r.fuerzaValor) + ' ' + esc(r.fuerzaUnidad) + '</td><td>' + f(d.fuerza.lbf) + '</td>' +
        '<td>' + f(d.presion.psi) + '</td><td>' + f(d.presion.kgfcm2) + '</td>' +
        '<td>' + (r.temp !== null && r.temp !== undefined ? f(r.temp, 1) + ' ' + esc(r.tempUnidad) : '—') + '</td>' +
        '<td>' + (r.tiempo ? f(r.tiempo, 1) : '—') + '</td><td class="obs">' + esc(r.obs || '') + '</td>' +
        (conAcciones ? '<td><div class="acc-fila"><button class="btn btn-chico" data-acc="editar" data-id="' + esc(r.id) + '">Editar</button>' +
          '<button class="btn btn-chico btn-peligro" data-acc="eliminar" data-id="' + esc(r.id) + '">Eliminar</button></div></td>' : '') + '</tr>';
    }).join('');
    return '<table><thead><tr><th class="txt">Fecha</th><th class="txt">Máquina</th><th class="txt">Montaje</th><th>Rubber cm</th>' +
      '<th class="c-aire">Manómetro (aire)</th><th class="c-fuerza">Fuerza leída</th><th class="c-fuerza">Fuerza lbf</th>' +
      '<th class="c-presion">Pres. rubber psi</th><th class="c-presion">kgf/cm²</th><th>Temp.</th><th>Tiempo s</th><th class="txt">Observaciones</th>' +
      (conAcciones ? '<th>Acciones</th>' : '') + '</tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function renderRubbers() {
    var vistos = {};
    registros.forEach(function (r) { vistos[Number(r.largo).toFixed(2) + 'x' + Number(r.ancho).toFixed(2)] = { l: r.largo, a: r.ancho }; });
    var claves = Object.keys(vistos);
    if (!claves.length) { $('#h-rubbers').innerHTML = vacio('Aparecerán aquí los tamaños de rubber registrados. También puedes generar una tabla en la sección 1.'); return; }
    $('#h-rubbers').innerHTML = '<div class="acciones">' + claves.map(function (k) {
      var v = vistos[k];
      return '<button class="btn" data-rubber-l="' + v.l + '" data-rubber-a="' + v.a + '">Rubber ' + f(v.l) + ' × ' + f(v.a) + ' cm</button>';
    }).join('') + '</div>';
  }

  function verEquivalencias(l, a) {
    $('#f-largo').value = String(l); $('#f-ancho').value = String(a);
    recordar('f-largo'); recordar('f-ancho');
    mostrarVista('v-fuerza');
    calcFuerza();
    generarTabla(false);
    $('#tabla-equivalencias').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Exportación ----------
  function filasExport(lista) {
    var r2 = function (v) { return typeof v === 'number' && isFinite(v) ? C.redondear(v, 2) : ''; };
    var filas = [[
      'Fecha', 'Máquina', 'Montaje', 'Largo rubber (cm)', 'Ancho rubber (cm)', 'Área rubber (cm²)', 'Área rubber (in²)',
      'Manómetro (valor)', 'Unidad manómetro', 'Manómetro (psi)',
      'Fuerza dinamómetro (valor)', 'Unidad fuerza', 'Fuerza (lbf)', 'Fuerza (kgf)', 'Fuerza (N)',
      'Presión prom. rubber (psi)', 'Presión prom. rubber (kgf/cm²)', 'Presión prom. rubber (bar)',
      'Temperatura', 'Unidad temperatura', 'Tiempo de aplicación (s)', 'Observaciones'
    ]];
    lista.forEach(function (r) {
      var d = derivados(r);
      filas.push([
        r.fecha, r.maquina, r.montaje || '', r2(r.largo), r2(r.ancho), r2(d.area.cm2), C.redondear(d.area.in2, 4),
        r2(r.manValor), NOMBRE_PRES[r.manUnidad], r2(d.manPsi),
        r2(r.fuerzaValor), r.fuerzaUnidad, r2(d.fuerza.lbf), r2(d.fuerza.kgf), r2(d.fuerza.N),
        r2(d.presion.psi), r2(d.presion.kgfcm2), r2(d.presion.bar),
        r.temp === null || r.temp === undefined ? '' : r2(r.temp), r.temp === null || r.temp === undefined ? '' : r.tempUnidad,
        r.tiempo ? r2(r.tiempo) : '', r.obs || ''
      ]);
    });
    return filas;
  }
  function aCSV(filas) {
    var celda = function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas inyectadas en Excel
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + filas.map(function (f) { return f.map(celda).join(','); }).join('\r\n');
  }
  function xlsxRegistros(lista) {
    var info = [
      ['Reporte', 'Medición Transfer — registros de calibración'],
      ['Generado', new Date().toLocaleString('es-HN')],
      ['Capacidad de la celda', textoCapacidad()],
      ['Aviso', TXT_PROMEDIO],
      ['Aviso', 'El manómetro mide presión del aire; el dinamómetro mide fuerza.'],
      ['Aviso', 'Confirma la capacidad y temperatura máxima de la celda antes de usarla.'],
      ['Aviso', 'No utilices los cálculos como ajuste de producción sin validar el montaje y los requisitos del proveedor del logo.']
    ];
    return XlsxMini.crearXlsx([{ nombre: 'Registros', filas: filasExport(lista) }, { nombre: 'Información', filas: info }]);
  }
  function nombreArchivo(ext) { return 'registros-transfer-' + hoyISO() + '.' + ext; }
  function verificarHay(lista) { if (!lista.length) { toast('No hay registros para exportar.', true); return false; } return true; }

  function imprimirReporte() {
    var lista = registrosFiltrados();
    if (!verificarHay(lista)) return;
    var maq = $('#h-maquina').value;
    var gs = {};
    lista.forEach(function (r) {
      var k = C.claveGrupo(r);
      if (!gs[k]) gs[k] = { maquina: r.maquina, montaje: r.montaje, largo: r.largo, ancho: r.ancho, regs: [] };
      gs[k].regs.push(r);
    });
    var graficas = Object.keys(gs).slice(0, 6).map(function (k) {
      return '<h2>' + esc(etiquetaGrupo(gs[k])) + '</h2>' + graficasGrupo(gs[k]);
    }).join('');
    $('#reporte').innerHTML = '<h1>Reporte de mediciones — Máquinas transfer</h1>' +
      '<p>Generado: ' + esc(new Date().toLocaleString('es-HN')) + ' · Filtro: ' + esc(maq || 'todas las máquinas') +
      ' · Registros: ' + lista.length + ' · Capacidad de la celda: ' + esc(textoCapacidad()) + '</p>' +
      AVISOS_HTML + '<h2>Registros</h2>' + tablaHistorialHTML(lista, false) + graficas;
    setTimeout(function () { window.print(); }, 50);
  }

  function respaldo() {
    var data = { app: 'medicion-transfer', formato: 1, version: APP_VERSION, exportado: new Date().toISOString(), ajustes: ajustes, registros: registros };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    compartirArchivo(blob, 'respaldo-transfer-' + hoyISO() + '.json', 'Respaldo Medición Transfer');
  }

  function validarRegistroImportado(r) {
    if (!r || typeof r !== 'object') return null;
    var num = function (v) { var n = C.parseNumero(v); return isNaN(n) ? null : n; };
    var out = {
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : nuevoId(),
      maquina: String(r.maquina || '').trim().slice(0, 60),
      montaje: String(r.montaje || '').trim().slice(0, 80),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) ? r.fecha : hoyISO(),
      largo: num(r.largo), ancho: num(r.ancho),
      manValor: num(r.manValor), manUnidad: r.manUnidad,
      fuerzaValor: num(r.fuerzaValor), fuerzaUnidad: r.fuerzaUnidad,
      temp: num(r.temp), tempUnidad: r.tempUnidad === '°F' ? '°F' : '°C',
      tiempo: num(r.tiempo), obs: String(r.obs || '').slice(0, 500),
      creado: typeof r.creado === 'string' ? r.creado : new Date().toISOString()
    };
    if (!out.maquina || !(out.largo > 0) || !(out.ancho > 0) || !(out.manValor > 0) || !(out.fuerzaValor > 0)) return null;
    if (C.UNIDADES_PRESION.indexOf(out.manUnidad) < 0 || C.UNIDADES_FUERZA.indexOf(out.fuerzaUnidad) < 0) return null;
    if (!(out.tiempo > 0)) out.tiempo = null;
    out.presionPsi = derivados(out).presion.psi;
    return out;
  }

  function importar(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    var lector = new FileReader();
    lector.onload = function () {
      var data;
      try { data = JSON.parse(lector.result); } catch (e) { toast('El archivo no es un respaldo válido.', true); return; }
      var lista = Array.isArray(data) ? data : data && data.registros;
      if (!Array.isArray(lista)) { toast('El archivo no contiene registros.', true); return; }
      var validos = lista.map(validarRegistroImportado).filter(Boolean);
      var invalidos = lista.length - validos.length;
      if (!validos.length) { toast('No se encontraron registros válidos.', true); return; }
      if (!confirm('Se importarán ' + validos.length + ' registros' + (invalidos ? ' (' + invalidos + ' inválidos se omitirán)' : '') +
        '. Los registros con el mismo identificador se reemplazarán. ¿Continuar?')) return;
      var porId = {};
      registros.forEach(function (r) { porId[r.id] = r; });
      validos.forEach(function (r) { porId[r.id] = r; });
      registros = Object.keys(porId).map(function (k) { return porId[k]; });
      guardarLS(LS_REG, registros);
      toast(validos.length + ' registros importados.');
      renderHistorial();
    };
    lector.onerror = function () { toast('No se pudo leer el archivo.', true); };
    lector.readAsText(file);
  }

  function borrarTodo() {
    if (!registros.length) { toast('No hay registros.'); return; }
    if (!confirm('¿Borrar TODOS los registros (' + registros.length + ') de este dispositivo? Descarga un respaldo antes si lo necesitas.')) return;
    if (!confirm('Confirmación final: esta acción no se puede deshacer.')) return;
    registros = [];
    guardarLS(LS_REG, registros);
    grupoSel = null;
    cancelarEdicion();
    renderHistorial();
    toast('Registros borrados.');
  }

  // ======================================================
  // AJUSTES, RED E INSTALACIÓN
  // ======================================================
  var eventoInstalar = null;
  function abrirAjustes() {
    $('#a-cap').value = ajustes.capValor > 0 ? String(ajustes.capValor) : '';
    $('#a-cap-u').value = ajustes.capUnidad || 'lbf';
    estadoCapacidad();
    renderInstalar();
    var d = $('#dlg-ajustes');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function estadoCapacidad() {
    var c = leer('a-cap');
    var el = $('#a-cap-estado');
    if (c.vacio) { el.textContent = 'Capacidad: no verificada.'; el.className = 'msg err'; }
    else if (c.ok) {
      var lbf = C.fuerzaALbf(c.v, $('#a-cap-u').value);
      var fz = C.fuerzaDesdeLbf(lbf);
      el.textContent = 'Equivale a ' + f(fz.lbf) + ' lbf · ' + f(fz.kgf) + ' kgf · ' + f(fz.N) + ' N.'; el.className = 'msg ok';
    } else { el.textContent = ''; }
  }
  function guardarAjustes() {
    var c = leer('a-cap');
    if (!c.ok) { $('#a-cap').focus(); return; }
    ajustes.capValor = c.v; ajustes.capUnidad = $('#a-cap-u').value;
    guardarLS(LS_AJ, ajustes);
    var d = $('#dlg-ajustes');
    if (d.close) d.close(); else d.removeAttribute('open');
    toast(c.v ? 'Capacidad guardada: ' + f(c.v) + ' ' + ajustes.capUnidad : 'Capacidad sin verificar');
    recalcularTodo();
  }
  function renderInstalar() {
    var cont = $('#a-instalar');
    var instalada = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (instalada) cont.innerHTML = '<p class="msg ok">La aplicación ya está instalada en este dispositivo.</p>';
    else if (eventoInstalar) cont.innerHTML = '<button type="button" class="btn btn-primario" id="a-btn-instalar">Instalar aplicación</button>';
    else cont.innerHTML = '';
    var b = $('#a-btn-instalar');
    if (b) b.addEventListener('click', function () {
      eventoInstalar.prompt();
      eventoInstalar.userChoice.finally(function () { eventoInstalar = null; renderInstalar(); });
    });
  }
  function estadoRed() {
    var p = $('#estado-red');
    if (navigator.onLine) { p.textContent = 'En línea'; p.className = 'pill'; }
    else { p.textContent = 'Sin conexión'; p.className = 'pill offline'; }
  }

  function recalcularTodo() {
    calcFuerza(); calcPresion(); previewRegistro();
    if (tablaEqActual) generarTabla(true);
    if (!$('#v-calibracion').hidden) renderCalibracion();
  }

  // ======================================================
  // INICIO
  // ======================================================
  function iniciar() {
    restaurarCampos();
    $('#c-fecha').value = hoyISO();
    $('#a-version').textContent = APP_VERSION;
    $$('[data-avisos]').forEach(function (d) { d.innerHTML = AVISOS_HTML; });
    $('#a-offline').textContent = 'Después de abrirla una vez con internet, las calculadoras, la calibración, el historial y las exportaciones funcionan sin conexión. ' +
      'Se necesita internet solo para la primera carga, para recibir actualizaciones y para enviar archivos por aplicaciones como correo o WhatsApp.';

    // Navegación
    $$('.nav-btn').forEach(function (b) { b.addEventListener('click', function () { mostrarVista(b.dataset.vista); }); });

    // Entradas que recalculan
    $$('input[data-req]').forEach(function (el) {
      el.addEventListener('blur', function () { leer(el.id, false); });
    });
    ['f-largo', 'f-ancho', 'f-psi'].forEach(function (id) {
      $('#' + id).addEventListener('input', function () { recordar(id); calcFuerza(); if (tablaEqActual) generarTabla(true); });
    });
    ['p-largo', 'p-ancho', 'p-lectura', 'p-unidad', 'pl-largo', 'pl-ancho'].forEach(function (id) {
      var ev = $('#' + id).tagName === 'SELECT' ? 'change' : 'input';
      $('#' + id).addEventListener(ev, function () { recordar(id); calcPresion(); });
    });
    $('#pl-total').addEventListener('change', calcPlancha);
    ['eq-inicio', 'eq-fin', 'eq-paso'].forEach(function (id) { $('#' + id).addEventListener('input', function () { recordar(id); leer(id); }); });
    $('#eq-modo').addEventListener('change', function () {
      var psi = this.value === 'psi';
      $('#eq-inicio').value = psi ? '10' : '5'; $('#eq-fin').value = psi ? '80' : '60'; $('#eq-paso').value = '5';
      ['eq-modo', 'eq-inicio', 'eq-fin', 'eq-paso'].forEach(recordar);
      actualizarUnidadEq(); generarTabla(true);
    });
    $('#eq-generar').addEventListener('click', function () { generarTabla(false); });
    $('#eq-csv').addEventListener('click', function () {
      if (!tablaEqActual) return;
      compartirArchivo(new Blob([aCSV(filasTablaEq())], { type: 'text/csv;charset=utf-8' }), nombreTablaEq('csv'), 'Tabla de equivalencias');
    });
    $('#eq-xlsx').addEventListener('click', function () {
      if (!tablaEqActual) return;
      var t = tablaEqActual;
      var filas = [['Rubber (cm)', f(t.largo) + ' × ' + f(t.ancho)], ['Área (cm²)', C.redondear(t.area.cm2, 2)], ['Área (in²)', C.redondear(t.area.in2, 4)], []].concat(filasTablaEq());
      compartirArchivo(XlsxMini.crearXlsx([{ nombre: 'Equivalencias', filas: filas }]), nombreTablaEq('xlsx'), 'Tabla de equivalencias');
    });
    $('#f-compartir').addEventListener('click', compartirFuerza);
    $('#p-compartir').addEventListener('click', compartirPresion);
    $('#p-a-registro').addEventListener('click', presionARegistro);

    // Calibración
    $('#form-registro').addEventListener('submit', guardarRegistro);
    ['c-largo', 'c-ancho', 'c-man', 'c-fuerza'].forEach(function (id) { $('#' + id).addEventListener('input', previewRegistro); });
    ['c-man-u', 'c-fuerza-u'].forEach(function (id) { $('#' + id).addEventListener('change', previewRegistro); });
    $('#c-cancelar').addEventListener('click', function () { cancelarEdicion(); });
    $('#c-limpiar').addEventListener('click', function () { if (editId) cancelarEdicion(); else limpiarFormulario(); });
    $('#g-grupo').addEventListener('change', function () { grupoSel = this.value; renderCalibracion(); });
    $('#s-psi').addEventListener('input', function () { recordar('s-psi'); renderSugerencia(); });

    // Historial
    $('#h-maquina').addEventListener('change', renderHistorial);
    $('#h-buscar').addEventListener('input', renderHistorial);
    $('#h-tabla').addEventListener('click', function (e) {
      var b = e.target.closest('[data-acc]');
      if (!b) return;
      if (b.dataset.acc === 'editar') editarRegistro(b.dataset.id);
      if (b.dataset.acc === 'eliminar') eliminarRegistro(b.dataset.id);
    });
    $('#h-rubbers').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rubber-l]');
      if (b) verEquivalencias(Number(b.dataset.rubberL), Number(b.dataset.rubberA));
    });
    $('#h-csv').addEventListener('click', function () {
      var l = registrosFiltrados(); if (!verificarHay(l)) return;
      descargar(new Blob([aCSV(filasExport(l))], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv'));
    });
    $('#h-xlsx').addEventListener('click', function () {
      var l = registrosFiltrados(); if (!verificarHay(l)) return;
      descargar(xlsxRegistros(l), nombreArchivo('xlsx'));
    });
    $('#h-compartir').addEventListener('click', function () {
      var l = registrosFiltrados(); if (!verificarHay(l)) return;
      compartirArchivo(xlsxRegistros(l), nombreArchivo('xlsx'), 'Registros Medición Transfer');
    });
    $('#h-pdf').addEventListener('click', imprimirReporte);
    $('#h-respaldo').addEventListener('click', respaldo);
    $('#h-importar').addEventListener('change', importar);
    $('label[for="h-importar"]').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#h-importar').click(); } });
    $('#h-borrar').addEventListener('click', borrarTodo);

    // Ajustes
    $('#btn-ajustes').addEventListener('click', abrirAjustes);
    $('#a-cap').addEventListener('input', estadoCapacidad);
    $('#a-cap-u').addEventListener('change', estadoCapacidad);
    $('#a-guardar').addEventListener('click', guardarAjustes);

    // Red e instalación
    window.addEventListener('online', estadoRed);
    window.addEventListener('offline', estadoRed);
    estadoRed();
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); eventoInstalar = e; });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* sin modo offline */ });
    }

    actualizarUnidadEq();
    calcFuerza();
    calcPresion();
    previewRegistro();
    var hash = (location.hash || '').replace('#', '');
    mostrarVista(hash ? 'v-' + hash : 'v-fuerza', true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
