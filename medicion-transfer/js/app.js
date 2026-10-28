/*
 * app.js — Interfaz de Medición Transfer v2.
 * Pantalla principal con módulos, máquinas Heat Transfer por serie o QR,
 * y registros guardados en la base de datos (db.js).
 */
(function () {
  'use strict';

  var APP_VERSION = '2.3.0';
  var C = window.Calc;
  var DB = window.DB;
  var LS_AJ = 'transfer.ajustes.v1';
  var LS_ULT = 'transfer.ultimos.v2';
  var LS_V1 = 'transfer.registros.v1';
  var LS_MIGR = 'transfer.migrado.v2';
  var MSG_SIN_CAL = 'No es posible determinar el ajuste del manómetro sin mediciones de esta máquina y este montaje.';
  var NOMBRE_PRES = { psi: 'psi', bar: 'bar', kgfcm2: 'kgf/cm²' };

  var VISTAS = {
    'vista-inicio': { hash: '', titulo: 'Medición Transfer', sub: 'Máquinas Heat Transfer' },
    'vista-calculo': { hash: 'calculo', titulo: 'Cálculo de presión', sub: 'Medición Transfer' },
    'vista-validacion': { hash: 'validacion', titulo: 'Validación de presión', sub: 'Medición Transfer' },
    'vista-pruebas': { hash: 'pruebas', titulo: 'Registro de pruebas', sub: 'Medición Transfer' },
    'vista-historial': { hash: 'historial', titulo: 'Historial y reportes', sub: 'Medición Transfer' }
  };
  var PREFIJO_TABLA = { cp: 'calculo_presion', vp: 'validacion_presion', rp: 'registro_pruebas' };

  // ---------- Utilidades ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function f(v, d) { return C.formatear(v, d === undefined ? 2 : d); }
  function r4(v) { return typeof v === 'number' && isFinite(v) ? C.redondear(v, 4) : null; }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function leerLS(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardarLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('No se pudo guardar en este navegador (' + e.name + ').', true); return false; }
  }
  function hoyISO() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function fechaLegible(iso) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function horaLegible(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' }); }
  function fechaHora(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-HN'); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : (v === null || v === undefined || v === '' ? null : Number(v)); }

  var toastTimer;
  function toast(msg, error) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (error ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }

  // ---------- Estado ----------
  var ajustes = leerLS(LS_AJ, { capValor: null, capUnidad: 'lbf' });
  var ultimos = leerLS(LS_ULT, {});
  var editId = null;
  var grupoSel = null;
  var modHist = 'calculo_presion';
  var vistaActual = 'vista-inicio';

  var DEFAULTS = {
    'cp-largo': '4.5', 'cp-ancho': '1.1', 'cp-psi': '40',
    'vp-largo': '4.5', 'vp-ancho': '1.1', 'vp-pl-largo': '30', 'vp-pl-ancho': '20', 's-psi': '40'
  };
  var RECORDAR = Object.keys(DEFAULTS).concat(['vp-lectura', 'vp-unidad', 'rp-man-u', 'rp-fuerza-u', 'rp-temp-u']);

  // ---------- Validación ----------
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

  // ---------- Bloques HTML ----------
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
    '<ul><li>' + TXT_PROMEDIO + '</li>' +
    '<li>El manómetro mide presión del aire; el dinamómetro mide fuerza.</li>' +
    '<li>Confirma la capacidad y temperatura máxima de la celda antes de usarla.</li>' +
    '<li>No utilices los cálculos como ajuste de producción sin validar el montaje y los requisitos del proveedor del logo.</li></ul>');
  var AVISO_PROMEDIO = aviso('info', 'Presión promedio estimada', TXT_PROMEDIO);

  function areaTiles(area) {
    return tile('area', 'Área', f(area.cm2), 'cm²') + tile('area', 'Área', f(area.in2), 'in²', 'Valor interno: ' + f(area.in2, 4) + ' in²');
  }
  function fuerzaTiles(fz, e) { return tile('fuerza principal', e, f(fz.lbf), 'lbf') + tile('fuerza', e, f(fz.kgf), 'kgf') + tile('fuerza', e, f(fz.N), 'N'); }
  function presionTiles(pr, e) { return tile('presion principal', e, f(pr.psi), 'psi') + tile('presion', e, f(pr.kgfcm2), 'kgf/cm²') + tile('presion', e, f(pr.bar), 'bar'); }

  // ---------- Capacidad de la celda ----------
  function capacidadLbf() {
    if (!(ajustes.capValor > 0)) return null;
    try { return C.fuerzaALbf(ajustes.capValor, ajustes.capUnidad); } catch (e) { return null; }
  }
  function textoCapacidad() { return ajustes.capValor > 0 ? f(ajustes.capValor) + ' ' + ajustes.capUnidad : 'no verificada'; }
  function htmlCapacidad(lbf) {
    var cap = capacidadLbf();
    if (cap === null) return aviso('alerta', 'Capacidad de la celda: no verificada', 'Ingresa la capacidad máxima de la celda en Ajustes (botón de engrane) para recibir alertas de sobrecarga.');
    var pct = lbf / cap * 100;
    var capTxt = f(cap) + ' lbf' + (ajustes.capUnidad !== 'lbf' ? ' (' + textoCapacidad() + ')' : '');
    if (lbf >= cap) return aviso('peligro', 'ATENCIÓN: la fuerza alcanza o supera la capacidad de la celda', 'Fuerza ' + f(lbf) + ' lbf ≥ capacidad ' + capTxt + ' — ' + f(pct, 0) + ' %. No apliques esta carga a la celda.');
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
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { toast('Resultado copiado. Pégalo en tu mensaje o correo.'); }, function () { toast('No se pudo copiar el resultado.', true); });
    } else toast('Este navegador no permite compartir ni copiar automáticamente.', true);
  }
  function compartirTexto(titulo, texto) {
    if (navigator.share) navigator.share({ title: titulo, text: texto }).catch(function (e) { if (e && e.name !== 'AbortError') copiar(texto); });
    else copiar(texto);
  }
  function compartirArchivo(blob, nombre, titulo) {
    var file;
    try { file = new File([blob], nombre, { type: blob.type }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: titulo }).catch(function (e) { if (e && e.name !== 'AbortError') descargar(blob, nombre); });
    } else { descargar(blob, nombre); toast('Este dispositivo no permite compartir archivos; se descargó el archivo.'); }
  }

  // ---------- Recordar valores ----------
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
    if (!el) return;
    ultimos[id] = el.value;
    guardarLS(LS_ULT, ultimos);
  }

  // ======================================================
  // MÁQUINAS HEAT TRANSFER (serie o QR)
  // ======================================================
  var MAQ = (window.MAQUINAS_HT || []).map(function (m) {
    m.id = m.serie || ('QR ' + (m.qr || m.asset));
    return m;
  });
  var sel = { cp: null, vp: null, rp: null };
  var candidatos = { cp: [], vp: [], rp: [] };

  function normSerie(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function codigo(s) {
    s = String(s || '').trim();
    var m = s.match(/^https?:\/\/[^\/]+\/(.+?)\/?$/i);
    if (m) s = m[1];
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  /** Busca por código QR / Asset ID primero, luego por serie. Puede devolver varias si el inventario tiene duplicados. */
  function buscarMaquinas(texto) {
    var c = codigo(texto), n = normSerie(texto);
    if (!c && !n) return [];
    var a = MAQ.filter(function (m) { return codigo(m.asset) === c; });
    if (a.length) return a;
    var q = MAQ.filter(function (m) { return m.qr && codigo(m.qr) === c; });
    if (q.length) return q;
    var s = MAQ.filter(function (m) { return m.serie && normSerie(m.serie) === n; });
    if (s.length) return s;
    return MAQ.filter(function (m) { return normSerie(m.id) === n; });
  }
  function maquinaDeRegistro(r) {
    var m = MAQ.find(function (x) { return x.id === r.maquina_serie && (!r.maquina_asset || x.asset === r.maquina_asset); }) ||
      MAQ.find(function (x) { return x.id === r.maquina_serie; });
    if (m) return m;
    return { id: r.maquina_serie, serie: r.maquina_serie, qr: r.maquina_qr || '', asset: r.maquina_asset || '', linea: r.maquina_linea || '',
      estacion: r.maquina_estacion || '', fabricante: '', estado: '', fueraInventario: true };
  }
  function datosMaquina(m) {
    return { maquina_serie: m.id, maquina_qr: m.qr || null, maquina_asset: m.asset || null, maquina_linea: m.linea || null, maquina_estacion: m.estacion || null };
  }

  var LINEAS = []; for (var nl = 1; nl <= 50; nl++) LINEAS.push('L' + nl);
  var PREFIJO_DE_TABLA = { calculo_presion: 'cp', validacion_presion: 'vp', registro_pruebas: 'rp' };
  /** Línea de operación elegida (L1–L50); muestra error si falta. */
  function exigirLinea(p) {
    var s = $('#' + p + '-linea'); if (!s) return null;
    var c = s.closest('.campo');
    if (!s.value) { c.classList.add('invalido'); c.querySelector('.error').textContent = 'Selecciona la línea donde se realiza la operación.'; return null; }
    c.classList.remove('invalido'); c.querySelector('.error').textContent = ''; return s.value;
  }
  function montarSelectores() {
    $('#lista-series').innerHTML = MAQ.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc((m.fabricante || '') + (m.qr ? ' · QR ' + codigo(m.qr) : '')) + '</option>';
    }).join('');
    $$('[data-maquina]').forEach(function (cont) {
      var p = cont.dataset.maquina;
      cont.innerHTML = '<div class="maq-sel" id="' + p + '-maq-box">' +
        '<label for="' + p + '-maq">Máquina Heat Transfer <span class="u">serie o QR</span></label>' +
        '<div class="maq-fila"><input id="' + p + '-maq" type="text" list="lista-series" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ej. PH59">' +
        '<button type="button" class="btn btn-primario" data-qr="' + p + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M7 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Escanear QR</button></div>' +
        '<p class="error" id="' + p + '-maq-err"></p><div class="maq-info" id="' + p + '-maq-info"></div></div>' +
        '<div class="campo"><label for="' + p + '-linea">Línea donde se realiza la operación</label>' +
        '<select id="' + p + '-linea"><option value="">Selecciona la línea…</option>' + LINEAS.map(function (l) { return '<option value="' + l + '">' + l + '</option>'; }).join('') + '</select>' +
        '<p class="error"></p></div>';
      var inp = $('#' + p + '-maq');
      var selLinea = $('#' + p + '-linea');
      if (ultimos[p + '-linea']) selLinea.value = ultimos[p + '-linea'];
      selLinea.addEventListener('change', function () {
        ultimos[p + '-linea'] = selLinea.value; guardarLS(LS_ULT, ultimos);
        var c = selLinea.closest('.campo'); c.classList.remove('invalido'); c.querySelector('.error').textContent = '';
      });
      inp.addEventListener('input', function () { resolverMaquina(p, inp.value, 'texto'); });
      inp.addEventListener('change', function () { resolverMaquina(p, inp.value, 'texto', true); });
      $('#' + p + '-maq-info').addEventListener('click', function (e) {
        var b = e.target.closest('[data-elegir]');
        if (b) elegirMaquina(p, candidatos[p][Number(b.dataset.elegir)]);
      });
      if (ultimos[p + '-maq']) { inp.value = ultimos[p + '-maq']; resolverMaquina(p, inp.value, 'texto'); }
    });
  }

  function resolverMaquina(p, texto, origen, final) {
    var info = $('#' + p + '-maq-info'), box = $('#' + p + '-maq-box'), err = $('#' + p + '-maq-err');
    var res = buscarMaquinas(texto);
    if (res.length === 1) { elegirMaquina(p, res[0]); return true; }
    sel[p] = null;
    box.classList.remove('elegida');
    err.textContent = '';
    if (res.length <= 1) delete info.dataset.cand;
    if (!String(texto).trim()) { info.innerHTML = ''; alCambiarMaquina(p); return false; }
    if (res.length > 1) {
      var claveCand = res.map(function (m) { return m.asset; }).join('|');
      if (info.dataset.cand === claveCand && info.querySelector('[data-elegir]')) { alCambiarMaquina(p); return false; }
      info.dataset.cand = claveCand;
      candidatos[p] = res;
      info.innerHTML = '<p class="msg">Hay ' + res.length + ' máquinas con ese dato en el inventario. Elige la correcta:</p><div class="maq-opciones">' +
        res.map(function (m, i) { return '<button type="button" class="btn btn-chico" data-elegir="' + i + '">' + esc(m.id) + ' · ' + esc(m.linea || 'sin línea') + ' · ' + esc(m.fabricante || '') + '</button>'; }).join('') + '</div>';
    } else if (origen === 'qr') {
      info.innerHTML = aviso('peligro', 'Código no encontrado', 'El QR leído (' + esc(texto) + ') no corresponde a una máquina Heat Transfer del inventario. Escribe la serie manualmente o revisa el código.');
    } else if (final || normSerie(texto).length >= 4) {
      info.innerHTML = '<p class="msg err">No se encontró esa serie en el inventario Heat Transfer.</p>';
    } else info.innerHTML = '';
    alCambiarMaquina(p);
    return false;
  }

  function elegirMaquina(p, m) {
    if (!m) return;
    sel[p] = m;
    var inp = $('#' + p + '-maq');
    if (document.activeElement !== inp || inp.value !== m.id) inp.value = m.id;
    var box = $('#' + p + '-maq-box');
    box.classList.add('elegida'); box.classList.remove('invalido');
    $('#' + p + '-maq-err').textContent = '';
    delete $('#' + p + '-maq-info').dataset.cand;
    $('#' + p + '-maq-info').innerHTML = '<div class="ficha"><b>' + esc(m.id) + '</b>' +
      (m.fabricante ? '<span>' + esc(m.fabricante) + (m.modelo && m.modelo !== 'n/t' ? ' ' + esc(m.modelo) : '') + '</span>' : '') +
      (m.qr ? '<span>QR ' + esc(codigo(m.qr)) + '</span>' : '') + '</div>' +
      (m.fueraInventario ? aviso('alerta', 'Fuera del inventario', 'Esta máquina no está en el inventario Heat Transfer cargado en la app.') : '') +
      (/INACTIVO/i.test(m.estado) ? aviso('alerta', 'Máquina INACTIVA en el inventario', 'Verifica que sea la máquina correcta.') : '');
    if (!m.fueraInventario) { ultimos[p + '-maq'] = m.id; guardarLS(LS_ULT, ultimos); }
    alCambiarMaquina(p);
  }

  function alCambiarMaquina(p) {
    if (p === 'rp' && sel.rp) {
      var l = leer('rp-largo'), a = leer('rp-ancho');
      if (l.ok && a.ok) {
        var k = C.claveGrupo({ maquina: sel.rp.id, largo: l.v, ancho: a.v, montaje: $('#rp-montaje').value });
        if (gruposPruebas()[k]) { grupoSel = k; renderGraficas(); }
      }
    }
  }

  function exigirMaquina(p) {
    if (sel[p]) return sel[p];
    var box = $('#' + p + '-maq-box');
    box.classList.add('invalido');
    $('#' + p + '-maq-err').textContent = 'Escanea el QR o escribe la serie de la máquina.';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }

  // ---------- Escáner QR ----------
  var qr = { destino: null, stream: null, loop: null, detector: null, canvas: null };
  function cargarJsQR() {
    return new Promise(function (res, rej) {
      if (window.jsQR) return res();
      var s = document.createElement('script');
      s.src = 'js/jsQR.js';
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('No se pudo cargar el lector de QR.')); };
      document.head.appendChild(s);
    });
  }
  async function abrirQR(p) {
    qr.destino = p;
    var dlg = $('#dlg-qr'), msg = $('#qr-msg');
    msg.textContent = 'Abriendo cámara…'; msg.className = 'msg';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'Este navegador no permite usar la cámara. Escribe la serie de la máquina.'; msg.className = 'msg err'; return;
    }
    try {
      qr.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      msg.textContent = e.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Actívalo en la configuración del navegador o escribe la serie.'
        : 'No se pudo abrir la cámara (' + e.name + '). Escribe la serie.';
      msg.className = 'msg err';
      return;
    }
    if (!dlg.open) { detenerCamara(); return; }
    var video = $('#qr-video');
    video.srcObject = qr.stream;
    try { await video.play(); } catch (e) { /* algunos navegadores reproducen solos */ }
    qr.detector = null;
    if ('BarcodeDetector' in window) {
      try {
        var formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.indexOf('qr_code') >= 0) qr.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) { qr.detector = null; }
    }
    if (!qr.detector) {
      try { await cargarJsQR(); } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; return; }
    }
    msg.textContent = 'Apunta la cámara al código QR de la máquina.';
    escanearQR();
  }
  function siguienteQR() { qr.loop = setTimeout(escanearQR, 160); }
  function escanearQR() {
    if (!qr.stream) return;
    var video = $('#qr-video');
    if (video.readyState < 2 || !video.videoWidth) return siguienteQR();
    if (qr.detector) {
      qr.detector.detect(video).then(function (cods) {
        if (cods && cods.length && cods[0].rawValue) qrLeido(cods[0].rawValue); else siguienteQR();
      }).catch(siguienteQR);
      return;
    }
    var esc2 = Math.min(1, 640 / video.videoWidth);
    var w = Math.round(video.videoWidth * esc2), h = Math.round(video.videoHeight * esc2);
    if (!qr.canvas) qr.canvas = document.createElement('canvas');
    qr.canvas.width = w; qr.canvas.height = h;
    var ctx = qr.canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    var r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) qrLeido(r.data); else siguienteQR();
  }
  function qrLeido(texto) {
    var p = qr.destino;
    cerrarQR();
    if (navigator.vibrate) navigator.vibrate(80);
    $('#' + p + '-maq').value = texto;
    if (resolverMaquina(p, texto, 'qr')) toast('Máquina ' + sel[p].id + ' seleccionada');
  }
  function detenerCamara() {
    clearTimeout(qr.loop);
    if (qr.stream) qr.stream.getTracks().forEach(function (t) { t.stop(); });
    qr.stream = null;
    var v = $('#qr-video');
    if (v) v.srcObject = null;
  }
  function cerrarQR() {
    detenerCamara();
    var d = $('#dlg-qr');
    if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
  }

  // ======================================================
  // NAVEGACIÓN
  // ======================================================
  function mostrarVista(id, opciones) {
    opciones = opciones || {};
    if (!VISTAS[id]) id = 'vista-inicio';
    vistaActual = id;
    $$('.vista').forEach(function (v) { v.hidden = v.id !== id; });
    $('#btn-inicio').hidden = id === 'vista-inicio';
    $('#logo').style.display = id === 'vista-inicio' ? '' : 'none';
    $('#titulo-app').textContent = VISTAS[id].titulo;
    $('#subtitulo-app').textContent = VISTAS[id].sub;
    document.title = id === 'vista-inicio' ? 'Medición Transfer' : VISTAS[id].titulo + ' · Medición Transfer';
    var hash = VISTAS[id].hash ? '#' + VISTAS[id].hash : location.pathname + location.search;
    try {
      if (opciones.reemplazar) history.replaceState({ vista: id }, '', hash);
      else if (!opciones.desdeHistorial) history.pushState({ vista: id }, '', hash);
    } catch (e) { /* sin historial */ }
    if (id === 'vista-inicio') renderInicio();
    if (id === 'vista-pruebas') renderGraficas();
    if (id === 'vista-historial') renderHistorial();
    if (!opciones.sinScroll) window.scrollTo(0, 0);
  }
  function vistaDesdeHash() {
    var h = (location.hash || '').replace('#', '');
    var id = Object.keys(VISTAS).find(function (k) { return VISTAS[k].hash && VISTAS[k].hash === h; });
    return id || 'vista-inicio';
  }

  // ======================================================
  // PANTALLA PRINCIPAL
  // ======================================================
  function textoEstadoBD() {
    var st = DB.estado(), pend = DB.pendientes();
    if (!DB.configurada()) return { cls: '', txt: 'Modo local' };
    if (!DB.sesion()) return { cls: 'pend', txt: 'Sin sesión' + (pend ? ' · ' + pend : '') };
    if (st.fase === 'sincronizando') return { cls: 'sync', txt: 'Sincronizando…' };
    if (st.fase === 'error') return { cls: 'err', txt: 'Error' + (pend ? ' · ' + pend : '') };
    if (st.fase === 'sin-red' || !navigator.onLine) return { cls: 'pend', txt: 'Sin conexión' + (pend ? ' · ' + pend : '') };
    if (pend) return { cls: 'pend', txt: pend + ' pendiente' + (pend === 1 ? '' : 's') };
    return { cls: 'ok', txt: 'Sincronizado' };
  }
  function renderEstadoBD() {
    var e = textoEstadoBD();
    var p = $('#estado-bd');
    p.textContent = e.txt; p.className = 'pill ' + e.cls;
    if (vistaActual === 'vista-inicio') renderInicio();
    if (vistaActual === 'vista-historial') renderAvisoHistorial();
    renderAjustesBD();
  }

  function htmlBD(compacto) {
    var st = DB.estado(), pend = DB.pendientes(), s = DB.sesion();
    if (!DB.configurada()) {
      return '<div><p><b>Modo local.</b> Los registros se guardan solo en este teléfono.</p>' +
        (compacto ? '' : '<p class="ayuda" style="margin:4px 0 0">Para compartirlos entre teléfonos configura la base de datos en la nube (ver README, sección Base de datos).</p>') + '</div>';
    }
    if (!s) {
      return '<div><p><b>Base de datos en la nube:</b> inicia sesión para sincronizar.</p>' +
        (pend ? '<p class="msg">' + pend + ' registro' + (pend === 1 ? '' : 's') + ' guardado' + (pend === 1 ? '' : 's') + ' en el teléfono, pendiente' + (pend === 1 ? '' : 's') + ' de subir.</p>' : '') +
        '</div><div class="acciones"><button type="button" class="btn btn-primario" data-accion="login">Iniciar sesión</button></div>';
    }
    return '<div><p><b>Conectado:</b> ' + esc(s.email) + '</p><p class="msg' + (st.fase === 'error' ? ' err' : '') + '">' +
      (st.fase === 'error' ? esc(st.mensaje) : (st.ultima ? 'Última sincronización: ' + esc(fechaHora(st.ultima)) : 'Aún no sincroniza.')) +
      (pend ? ' · ' + pend + ' pendiente' + (pend === 1 ? '' : 's') : '') + '</p></div>' +
      '<div class="acciones"><button type="button" class="btn" data-accion="sync">Sincronizar</button></div>';
  }

  function renderInicio() {
    $('#inicio-bd').innerHTML = htmlBD(false);
    var hoy = hoyISO(), total = 0, totalHoy = 0, maqs = {};
    Object.keys(DB.TABLAS).forEach(function (t) {
      var lista = DB.listar(t);
      var nHoy = lista.filter(function (r) { return String(r.fecha || '').slice(0, 10) === hoy; }).length;
      var pend = DB.configurada() ? DB.pendientes(t) : 0;
      total += lista.length; totalHoy += nHoy;
      lista.forEach(function (r) { maqs[r.maquina_serie] = 1; });
      $('[data-stats="' + t + '"]').innerHTML = '<span>Hoy <b>' + nHoy + '</b></span><span>Guardados <b>' + lista.length + '</b></span>' +
        (pend ? '<span class="pend">Por subir <b>' + pend + '</b></span>' : '');
    });
    var nMaq = Object.keys(maqs).length;
    $('[data-stats="historial"]').innerHTML = '<span>Registros <b>' + total + '</b></span><span>Máquinas <b>' + nMaq + '</b></span>';
    $('#inicio-totales').innerHTML = '<div><b>' + totalHoy + '</b><span>Mediciones hoy</span></div>' +
      '<div><b>' + total + '</b><span>Registros guardados</span></div><div><b>' + nMaq + '</b><span>Máquinas medidas</span></div>';
  }

  // ======================================================
  // 1. CÁLCULO DE PRESIÓN
  // ======================================================
  var ultimoCalculo = null;
  function calcCalculo() {
    var l = leer('cp-largo'), a = leer('cp-ancho'), p = leer('cp-psi');
    if (!(l.ok && a.ok && p.ok)) {
      ultimoCalculo = null;
      $('#cp-resultados').innerHTML = vacio('Ingresa largo, ancho y presión deseada (números mayores que cero).');
      $('#cp-capacidad').innerHTML = '';
      return;
    }
    var r = C.fuerzaNecesaria(l.v, a.v, p.v);
    ultimoCalculo = { l: l.v, a: a.v, p: p.v, r: r };
    $('#cp-resultados').innerHTML =
      grupo('Área del rubber', areaTiles(r.area)) +
      grupo('<span class="tag tag-fuerza">Fuerza necesaria</span> (lectura objetivo del dinamómetro)', fuerzaTiles(r.fuerza, 'Fuerza')) +
      grupo('<span class="tag tag-presion">Presión promedio deseada</span> sobre el rubber', presionTiles(r.presion, 'Presión')) + AVISO_PROMEDIO;
    $('#cp-capacidad').innerHTML = htmlCapacidad(r.fuerza.lbf);
  }

  function guardarCalculo() {
    var msg = $('#cp-msg');
    var m = exigirMaquina('cp');
    var l = leer('cp-largo', true), a = leer('cp-ancho', true), p = leer('cp-psi', true);
    if (!m || !(l.ok && a.ok && p.ok)) { msg.textContent = 'Completa la máquina y los datos marcados en rojo.'; msg.className = 'msg err'; return; }
    var r = C.fuerzaNecesaria(l.v, a.v, p.v);
    var reg = Object.assign(datosMaquina(m), {
      fecha: hoyISO(), usuario_email: usuarioActual(),
      rubber_largo_cm: l.v, rubber_ancho_cm: a.v, area_cm2: r4(r.area.cm2), area_in2: r4(r.area.in2),
      presion_deseada_psi: p.v, fuerza_lbf: r4(r.fuerza.lbf), fuerza_kgf: r4(r.fuerza.kgf), fuerza_n: r4(r.fuerza.N),
      capacidad_celda: textoCapacidad(), observaciones: $('#cp-obs').value.trim() || null
    });
    guardarEnBD('calculo_presion', reg, msg, function () { $('#cp-obs').value = ''; elegirMaquina('cp', m); });
  }

  function compartirCalculo() {
    if (!ultimoCalculo) { toast('Completa los datos primero.', true); return; }
    var u = ultimoCalculo, r = u.r;
    compartirTexto('Cálculo de presión', [
      'CÁLCULO DE PRESIÓN — Medición Transfer',
      'Máquina: ' + (sel.cp ? sel.cp.id + (sel.cp.linea ? ' (' + sel.cp.linea + ')' : '') : 'sin seleccionar'),
      'Rubber: ' + f(u.l) + ' × ' + f(u.a) + ' cm (' + f(r.area.cm2) + ' cm² / ' + f(r.area.in2, 4) + ' in²)',
      'Presión promedio deseada sobre el rubber: ' + f(u.p) + ' psi (' + f(r.presion.kgfcm2) + ' kgf/cm², ' + f(r.presion.bar) + ' bar)',
      'Fuerza necesaria: ' + f(r.fuerza.lbf) + ' lbf = ' + f(r.fuerza.kgf) + ' kgf = ' + f(r.fuerza.N) + ' N',
      'Capacidad de la celda: ' + textoCapacidad(),
      'Nota: presión promedio estimada; no es la presión del aire del manómetro.'
    ].join('\n'));
  }

  // ======================================================
  // 2. VALIDACIÓN DE PRESIÓN
  // ======================================================
  var ultimaValidacion = null;
  function calcValidacion() {
    var l = leer('vp-largo'), a = leer('vp-ancho'), x = leer('vp-lectura');
    var u = $('#vp-unidad').value;
    if (!(l.ok && a.ok && x.ok)) {
      ultimaValidacion = null;
      $('#vp-resultados').innerHTML = vacio('Ingresa largo, ancho y la lectura del dinamómetro (números mayores que cero).');
      $('#vp-capacidad').innerHTML = '';
    } else {
      var r = C.presionMedida(l.v, a.v, x.v, u);
      ultimaValidacion = { l: l.v, a: a.v, x: x.v, u: u, r: r };
      $('#vp-resultados').innerHTML =
        grupo('Área del rubber', areaTiles(r.area)) +
        grupo('<span class="tag tag-fuerza">Fuerza medida</span> (dinamómetro)', fuerzaTiles(r.fuerza, 'Fuerza')) +
        grupo('<span class="tag tag-presion">Presión promedio estimada</span> sobre el rubber', presionTiles(r.presion, 'Presión')) + AVISO_PROMEDIO;
      $('#vp-capacidad').innerHTML = htmlCapacidad(r.fuerza.lbf);
    }
    calcPlancha();
  }
  function datosPlancha() {
    var l = leer('vp-pl-largo'), a = leer('vp-pl-ancho');
    if (!(l.ok && a.ok) || l.vacio || a.vacio) return null;
    var area = C.areaRect(l.v, a.v);
    var total = $('#vp-pl-total').checked;
    var pr = total && ultimaValidacion ? C.presionDesdePsi(ultimaValidacion.r.fuerza.lbf / area.in2) : null;
    return { l: l.v, a: a.v, area: area, total: total, presion: pr };
  }
  function calcPlancha() {
    var out = $('#vp-pl-resultados');
    var d = datosPlancha();
    if (!d) { out.innerHTML = vacio('Ingresa largo y ancho de la plancha para ver su área.'); return; }
    var html = grupo('Área de la plancha', areaTiles(d.area));
    if (!d.total) html += aviso('info', 'Presión sobre la plancha: no calculada', 'Marca la casilla solo si la fuerza medida corresponde a toda la fuerza aplicada sobre la plancha completa. No se asume que toda la plancha esté en contacto en producción.');
    else if (!d.presion) html += vacio('Ingresa la lectura del dinamómetro arriba.');
    else html += grupo('<span class="tag tag-presion">Presión promedio sobre la plancha completa</span>', presionTiles(d.presion, 'Plancha')) +
      aviso('alerta', 'Resultado distinto al del rubber', 'Este valor reparte la fuerza en toda la plancha (' + f(d.area.cm2) + ' cm²). La presión sobre el logo se calcula con el área del rubber, arriba.');
    out.innerHTML = html;
  }

  function guardarValidacion() {
    var msg = $('#vp-msg');
    var m = exigirMaquina('vp');
    var l = leer('vp-largo', true), a = leer('vp-ancho', true), x = leer('vp-lectura', true);
    var pl = leer('vp-pl-largo'), pa = leer('vp-pl-ancho');
    if (!m || !(l.ok && a.ok && x.ok && pl.ok && pa.ok)) { msg.textContent = 'Completa la máquina y los datos marcados en rojo.'; msg.className = 'msg err'; return; }
    var u = $('#vp-unidad').value;
    var r = C.presionMedida(l.v, a.v, x.v, u);
    ultimaValidacion = { l: l.v, a: a.v, x: x.v, u: u, r: r };
    var d = datosPlancha();
    var reg = Object.assign(datosMaquina(m), {
      fecha: hoyISO(), usuario_email: usuarioActual(),
      rubber_largo_cm: l.v, rubber_ancho_cm: a.v, area_cm2: r4(r.area.cm2), area_in2: r4(r.area.in2),
      lectura_valor: x.v, lectura_unidad: u,
      fuerza_lbf: r4(r.fuerza.lbf), fuerza_kgf: r4(r.fuerza.kgf), fuerza_n: r4(r.fuerza.N),
      presion_psi: r4(r.presion.psi), presion_kgfcm2: r4(r.presion.kgfcm2), presion_bar: r4(r.presion.bar),
      plancha_largo_cm: d ? d.l : null, plancha_ancho_cm: d ? d.a : null, plancha_area_cm2: d ? r4(d.area.cm2) : null,
      fuerza_total_plancha: !!(d && d.total), plancha_presion_psi: d && d.presion ? r4(d.presion.psi) : null,
      capacidad_celda: textoCapacidad(), observaciones: $('#vp-obs').value.trim() || null
    });
    guardarEnBD('validacion_presion', reg, msg, function () { $('#vp-obs').value = ''; elegirMaquina('vp', m); });
  }

  function compartirValidacion() {
    if (!ultimaValidacion) { toast('Completa los datos primero.', true); return; }
    var u = ultimaValidacion, r = u.r;
    compartirTexto('Validación de presión', [
      'VALIDACIÓN DE PRESIÓN — Medición Transfer',
      'Máquina: ' + (sel.vp ? sel.vp.id + (sel.vp.linea ? ' (' + sel.vp.linea + ')' : '') : 'sin seleccionar'),
      'Rubber: ' + f(u.l) + ' × ' + f(u.a) + ' cm (' + f(r.area.cm2) + ' cm² / ' + f(r.area.in2, 4) + ' in²)',
      'Lectura del dinamómetro: ' + f(u.x) + ' ' + u.u + ' = ' + f(r.fuerza.lbf) + ' lbf = ' + f(r.fuerza.kgf) + ' kgf = ' + f(r.fuerza.N) + ' N',
      'Presión promedio estimada sobre el rubber: ' + f(r.presion.psi) + ' psi = ' + f(r.presion.kgfcm2) + ' kgf/cm² = ' + f(r.presion.bar) + ' bar',
      'Capacidad de la celda: ' + textoCapacidad(),
      'Nota: presión promedio estimada; puede variar entre el centro y las esquinas. No es la presión del aire del manómetro.'
    ].join('\n'));
  }

  function validacionAPruebas() {
    if (!ultimaValidacion) { toast('Completa los datos primero.', true); return; }
    cancelarEdicion();
    $('#rp-largo').value = String(ultimaValidacion.l);
    $('#rp-ancho').value = String(ultimaValidacion.a);
    $('#rp-fuerza').value = String(ultimaValidacion.x);
    $('#rp-fuerza-u').value = ultimaValidacion.u;
    if ($('#vp-linea').value) $('#rp-linea').value = $('#vp-linea').value;
    if (sel.vp) { $('#rp-maq').value = sel.vp.id; elegirMaquina('rp', sel.vp); }
    mostrarVista('vista-pruebas');
    previewPrueba();
    $('#rp-man').focus();
    toast('Ingresa la presión del manómetro y guarda.');
  }

  // ---------- Guardado común ----------
  function usuarioActual() { var s = DB.sesion(); return s ? s.email : null; }
  function guardarEnBD(tabla, reg, msgEl, despues) {
    var linea = exigirLinea(PREFIJO_DE_TABLA[tabla]);
    if (!linea) { msgEl.textContent = 'Selecciona la línea donde se realiza la operación.'; msgEl.className = 'msg err'; return false; }
    reg.linea_operacion = linea;
    var boton = msgEl.closest('.card, form').querySelector('.btn-primario.btn-grande');
    if (boton) { boton.disabled = true; setTimeout(function () { boton.disabled = false; }, 1200); }
    try { DB.guardar(tabla, reg); }
    catch (e) { msgEl.textContent = e.message; msgEl.className = 'msg err'; toast(e.message, true); return false; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var destino = DB.configurada() && DB.sesion() ? (navigator.onLine === false ? 'Guardado en el teléfono; se subirá al volver la conexión.' : 'Se sube a la base de datos en la nube.') :
      (DB.configurada() ? 'Guardado en el teléfono; se subirá al iniciar sesión.' : 'Guardado en este teléfono (modo local).');
    msgEl.textContent = 'Registro guardado (' + reg.maquina_serie + '). ' + destino;
    msgEl.className = 'msg ok';
    toast('Registro guardado');
    if (despues) despues();
    return true;
  }

  // ======================================================
  // 3. REGISTRO DE PRUEBAS
  // ======================================================
  function derivadosPrueba(r) {
    var area = C.areaRect(num(r.rubber_largo_cm), num(r.rubber_ancho_cm));
    var lbf = C.fuerzaALbf(num(r.fuerza_valor), r.fuerza_unidad);
    return { area: area, fuerza: C.fuerzaDesdeLbf(lbf), presion: C.presionDesdePsi(lbf / area.in2), manPsi: C.presionAPsi(num(r.manometro_valor), r.manometro_unidad) };
  }
  function claveDe(r) { return C.claveGrupo({ maquina: r.maquina_serie, largo: num(r.rubber_largo_cm), ancho: num(r.rubber_ancho_cm), montaje: r.montaje }); }

  function previewPrueba() {
    var l = leer('rp-largo'), a = leer('rp-ancho'), fz = leer('rp-fuerza'), m = leer('rp-man');
    var out = $('#rp-preview');
    if (!(l.ok && a.ok && fz.ok)) { out.innerHTML = vacio('La presión promedio sobre el rubber se calcula al ingresar rubber y fuerza.'); return; }
    var r = C.presionMedida(l.v, a.v, fz.v, $('#rp-fuerza-u').value);
    var html = '<div class="res-grid">';
    if (m.ok) html += tile('aire', 'Manómetro (aire)', f(m.v), NOMBRE_PRES[$('#rp-man-u').value]);
    html += tile('fuerza', 'Fuerza medida', f(r.fuerza.lbf), 'lbf') +
      tile('presion', 'Presión prom. rubber', f(r.presion.psi), 'psi', f(r.presion.kgfcm2) + ' kgf/cm² · ' + f(r.presion.bar) + ' bar') + '</div>';
    out.innerHTML = html + htmlCapacidad(r.fuerza.lbf);
  }

  function guardarPrueba(ev) {
    ev.preventDefault();
    var msg = $('#rp-msg');
    var m = exigirMaquina('rp');
    var fecha = $('#rp-fecha').value;
    var errF = $('#rp-fecha').closest('.campo').querySelector('.error');
    errF.textContent = fecha ? '' : 'Indica la fecha.';
    $('#rp-fecha').closest('.campo').classList.toggle('invalido', !fecha);
    var c = {
      largo: leer('rp-largo', true), ancho: leer('rp-ancho', true), man: leer('rp-man', true),
      fuerza: leer('rp-fuerza', true), temp: leer('rp-temp', true), tiempo: leer('rp-tiempo', true)
    };
    var ok = m && fecha && Object.keys(c).every(function (k) { return c[k].ok; });
    if (!ok) {
      msg.textContent = 'Completa la máquina y los campos marcados en rojo.'; msg.className = 'msg err';
      var primero = $('.campo.invalido input', $('#form-pruebas'));
      if (primero && m) primero.focus();
      return;
    }
    var base = {
      fecha: fecha, montaje: $('#rp-montaje').value.trim() || null,
      rubber_largo_cm: c.largo.v, rubber_ancho_cm: c.ancho.v,
      manometro_valor: c.man.v, manometro_unidad: $('#rp-man-u').value,
      fuerza_valor: c.fuerza.v, fuerza_unidad: $('#rp-fuerza-u').value,
      temperatura: c.temp.v, temperatura_unidad: c.temp.v === null ? null : $('#rp-temp-u').value,
      tiempo_s: c.tiempo.v, observaciones: $('#rp-obs').value.trim() || null, capacidad_celda: textoCapacidad()
    };
    var d = derivadosPrueba(base);
    var reg = Object.assign(datosMaquina(m), base, {
      area_cm2: r4(d.area.cm2), area_in2: r4(d.area.in2), manometro_psi: r4(d.manPsi),
      fuerza_lbf: r4(d.fuerza.lbf), fuerza_kgf: r4(d.fuerza.kgf), fuerza_n: r4(d.fuerza.N),
      presion_psi: r4(d.presion.psi), presion_kgfcm2: r4(d.presion.kgfcm2), presion_bar: r4(d.presion.bar)
    });
    if (editId) {
      var prev = DB.obtener('registro_pruebas', editId);
      reg.id = editId;
      reg.usuario_email = prev && prev.usuario_email ? prev.usuario_email : usuarioActual();
    } else reg.usuario_email = usuarioActual();
    var eraEdicion = !!editId;
    if (!guardarEnBD('registro_pruebas', reg, msg)) return;
    grupoSel = claveDe(reg);
    cancelarEdicion(true);
    // conservar máquina, montaje, rubber y unidades para la siguiente prueba
    elegirMaquina('rp', m);
    $('#rp-montaje').value = reg.montaje || '';
    $('#rp-largo').value = String(reg.rubber_largo_cm); $('#rp-ancho').value = String(reg.rubber_ancho_cm);
    $('#rp-man-u').value = reg.manometro_unidad; $('#rp-fuerza-u').value = reg.fuerza_unidad;
    $('#rp-fecha').value = reg.fecha;
    if (eraEdicion) msg.textContent = 'Registro actualizado.';
    else msg.textContent += ' Ingresa la siguiente prueba con otro ajuste del manómetro.';
    previewPrueba();
    renderGraficas();
  }

  function limpiarFormulario(mantenerMsg) {
    ['rp-montaje', 'rp-largo', 'rp-ancho', 'rp-man', 'rp-fuerza', 'rp-temp', 'rp-tiempo', 'rp-obs'].forEach(function (id) { $('#' + id).value = ''; });
    $('#rp-fecha').value = hoyISO();
    $$('#form-pruebas .campo').forEach(function (c) { c.classList.remove('invalido'); var e = c.querySelector('.error'); if (e) e.textContent = ''; });
    if (!mantenerMsg) $('#rp-msg').textContent = '';
    previewPrueba();
  }
  function cancelarEdicion(mantenerMsg) {
    editId = null;
    $('#rp-titulo').textContent = 'Nueva prueba';
    $('#rp-guardar').textContent = 'Guardar registro';
    $('#rp-cancelar').hidden = true;
    limpiarFormulario(mantenerMsg);
  }
  function editarPrueba(id) {
    var r = DB.obtener('registro_pruebas', id);
    if (!r) return;
    if (!puedeModificar(r)) { toast('Solo el administrador puede editar registros guardados en la nube.', true); return; }
    editId = id;
    mostrarVista('vista-pruebas');
    elegirMaquina('rp', maquinaDeRegistro(r));
    $('#rp-montaje').value = r.montaje || '';
    $('#rp-linea').value = r.linea_operacion || '';
    $('#rp-fecha').value = String(r.fecha || hoyISO()).slice(0, 10);
    $('#rp-largo').value = String(r.rubber_largo_cm); $('#rp-ancho').value = String(r.rubber_ancho_cm);
    $('#rp-man').value = String(r.manometro_valor); $('#rp-man-u').value = r.manometro_unidad;
    $('#rp-fuerza').value = String(r.fuerza_valor); $('#rp-fuerza-u').value = r.fuerza_unidad;
    $('#rp-temp').value = r.temperatura === null || r.temperatura === undefined ? '' : String(r.temperatura);
    $('#rp-temp-u').value = r.temperatura_unidad || '°C';
    $('#rp-tiempo').value = r.tiempo_s === null || r.tiempo_s === undefined ? '' : String(r.tiempo_s);
    $('#rp-obs').value = r.observaciones || '';
    $('#rp-titulo').textContent = 'Editar prueba';
    $('#rp-guardar').textContent = 'Guardar cambios';
    $('#rp-cancelar').hidden = false;
    $('#rp-msg').textContent = '';
    previewPrueba();
    $('#form-pruebas').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function actualizarMontajes() {
    var monts = {};
    DB.listar('registro_pruebas').forEach(function (r) { if (r.montaje) monts[r.montaje] = 1; });
    $('#lista-montajes').innerHTML = Object.keys(monts).sort().map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
  }

  function gruposPruebas(lista) {
    var g = {};
    (lista || DB.listar('registro_pruebas')).forEach(function (r) {
      var k = claveDe(r);
      if (!g[k]) g[k] = { clave: k, maquina: r.maquina_serie, linea: r.maquina_linea, montaje: r.montaje, largo: num(r.rubber_largo_cm), ancho: num(r.rubber_ancho_cm), regs: [] };
      g[k].regs.push(r);
    });
    return g;
  }
  function etiquetaGrupo(g) {
    return g.maquina + (g.linea ? ' (' + g.linea + ')' : '') + ' · ' + f(g.largo) + '×' + f(g.ancho) + ' cm · ' + (g.montaje || 'montaje sin especificar') + ' (' + g.regs.length + ')';
  }

  // ---------- Gráficas ----------
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
    for (var gx = 0; gx <= xmax + 1e-9; gx += sx) s += '<line class="rejilla" x1="' + X(gx) + '" x2="' + X(gx) + '" y1="' + mt + '" y2="' + (H - mb) + '"/><text x="' + X(gx) + '" y="' + (H - mb + 18) + '" text-anchor="middle">' + C.redondear(gx, 2) + '</text>';
    for (var gy = 0; gy <= ymax + 1e-9; gy += sy) s += '<line class="rejilla" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(gy) + '" y2="' + Y(gy) + '"/><text x="' + (ml - 8) + '" y="' + (Y(gy) + 4) + '" text-anchor="end">' + C.redondear(gy, 2) + '</text>';
    s += '<line class="eje" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (H - mb) + '" y2="' + (H - mb) + '"/><line class="eje" x1="' + ml + '" x2="' + ml + '" y1="' + mt + '" y2="' + (H - mb) + '"/>';
    s += '<text x="' + ((W + ml) / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(op.xLab) + '</text><text transform="translate(16 ' + ((H - mb + mt) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(op.yLab) + '</text>';
    if (op.reg) s += '<line x1="' + X(op.reg.xmin) + '" y1="' + Y(op.reg.m * op.reg.xmin + op.reg.b) + '" x2="' + X(op.reg.xmax) + '" y2="' + Y(op.reg.m * op.reg.xmax + op.reg.b) + '" stroke="' + op.color + '" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>';
    puntos.forEach(function (p) { s += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="7" fill="' + op.color + '" stroke="#fff" stroke-width="2"><title>' + C.redondear(p.x, 2) + ' → ' + C.redondear(p.y, 2) + '</title></circle>'; });
    return '<div class="grafica"><h4>' + esc(titulo) + '</h4>' + s + '</svg></div>';
  }
  function colorVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#0b6bb5'; }
  function graficasGrupo(g) {
    var pts = g.regs.map(function (r) { var d = derivadosPrueba(r); return { x: d.manPsi, f: d.fuerza.lbf, p: d.presion.psi }; });
    var rf = C.regresionLineal(pts.map(function (p) { return { x: p.x, y: p.f }; }));
    var rpz = C.regresionLineal(pts.map(function (p) { return { x: p.x, y: p.p }; }));
    var xs = pts.map(function (p) { return p.x; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    return graficaSVG('Fuerza medida vs. presión del manómetro', pts.map(function (p) { return { x: p.x, y: p.f }; }),
      { xLab: 'Presión del manómetro (aire), psi', yLab: 'Fuerza medida, lbf', color: colorVar('--fuerza'), reg: rf && rf.m > 0 ? { m: rf.m, b: rf.b, xmin: xmin, xmax: xmax } : null }) +
      graficaSVG('Presión promedio en el rubber vs. presión del manómetro', pts.map(function (p) { return { x: p.x, y: p.p }; }),
      { xLab: 'Presión del manómetro (aire), psi', yLab: 'Presión prom. rubber, psi', color: colorVar('--presion'), reg: rpz && rpz.m > 0 ? { m: rpz.m, b: rpz.b, xmin: xmin, xmax: xmax } : null });
  }

  function renderGraficas() {
    actualizarMontajes();
    var gs = gruposPruebas();
    var claves = Object.keys(gs);
    var s = $('#g-grupo');
    if (!claves.length) {
      s.innerHTML = '<option value="">Sin registros todavía</option>'; s.disabled = true;
      $('#g-graficas').innerHTML = vacio('Guarda pruebas para ver la gráfica de la máquina.');
      $('#g-tabla').innerHTML = '';
      renderSugerencia();
      return;
    }
    s.disabled = false;
    if (!grupoSel || !gs[grupoSel]) {
      var recientes = DB.listar('registro_pruebas').slice().sort(function (a, b) { return String(b.creado).localeCompare(String(a.creado)); });
      grupoSel = claveDe(recientes[0]);
    }
    s.innerHTML = claves.sort().map(function (k) { return '<option value="' + esc(k) + '"' + (k === grupoSel ? ' selected' : '') + '>' + esc(etiquetaGrupo(gs[k])) + '</option>'; }).join('');
    var g = gs[grupoSel];
    $('#g-graficas').innerHTML = graficasGrupo(g) + '<p class="ayuda">Cada punto es una prueba. La línea punteada es el ajuste lineal de los datos medidos y solo se dibuja dentro del rango medido.</p>';
    var filas = g.regs.slice().sort(function (a, b) { return derivadosPrueba(a).manPsi - derivadosPrueba(b).manPsi; }).map(function (r) {
      var d = derivadosPrueba(r);
      return '<tr><td class="txt">' + fechaLegible(r.fecha) + '</td><td>' + f(num(r.manometro_valor)) + ' ' + NOMBRE_PRES[r.manometro_unidad] + '</td><td>' + f(d.manPsi) +
        '</td><td>' + f(d.fuerza.lbf) + '</td><td>' + f(d.fuerza.kgf) + '</td><td>' + f(d.presion.psi) + '</td></tr>';
    }).join('');
    $('#g-tabla').innerHTML = '<div class="tabla-scroll"><table><thead><tr><th class="txt">Fecha</th><th class="c-aire">Manómetro</th><th class="c-aire">Manóm. psi</th>' +
      '<th class="c-fuerza">Fuerza lbf</th><th class="c-fuerza">Fuerza kgf</th><th class="c-presion">Pres. rubber psi</th></tr></thead><tbody>' + filas + '</tbody></table></div>';
    renderSugerencia();
  }

  function renderSugerencia() {
    var out = $('#s-resultado');
    var p = leer('s-psi');
    var g = grupoSel ? gruposPruebas()[grupoSel] : null;
    if (!g) { out.innerHTML = aviso('info', MSG_SIN_CAL, 'Registra al menos 2 pruebas de la misma máquina, rubber y montaje con distintas presiones de manómetro.'); return; }
    if (!p.ok) { out.innerHTML = vacio('Ingresa la presión deseada sobre el rubber.'); return; }
    var area = C.areaRect(g.largo, g.ancho);
    var objetivo = p.v * area.in2;
    var pts = g.regs.map(function (r) { var d = derivadosPrueba(r); return { manPsi: d.manPsi, fuerzaLbf: d.fuerza.lbf }; });
    var s = C.sugerirManometro(pts, objetivo);
    var cab = '<p>Para <b>' + f(p.v) + ' psi</b> promedio sobre el rubber de ' + f(g.largo) + ' × ' + f(g.ancho) + ' cm se necesita una fuerza de <b>' +
      f(objetivo) + ' lbf</b> (' + f(objetivo / C.K.LB_POR_KG) + ' kgf · ' + f(objetivo * C.K.N_POR_LBF) + ' N).</p>';
    if (!s.ok) { out.innerHTML = cab + aviso('info', MSG_SIN_CAL, esc(s.detalle)); return; }
    var unidades = {};
    g.regs.forEach(function (r) { unidades[r.manometro_unidad] = (unidades[r.manometro_unidad] || 0) + 1; });
    var uP = Object.keys(unidades).sort(function (a, b) { return unidades[b] - unidades[a]; })[0];
    var vP = uP === 'psi' ? s.man.psi : uP === 'bar' ? s.man.bar : s.man.kgfcm2;
    var html = cab + '<div class="estimacion"><span class="etiqueta">ESTIMACIÓN</span>' +
      '<p style="margin:8px 0 6px">Ajuste aproximado del <span class="tag tag-aire">manómetro</span> para <b>' + esc(g.maquina) + '</b>:</p>' +
      '<div class="res-grid">' + tile('aire principal', 'Manómetro', f(vP), NOMBRE_PRES[uP]) +
      (uP !== 'psi' ? tile('aire', 'Manómetro', f(s.man.psi), 'psi') : '') + (uP !== 'bar' ? tile('aire', 'Manómetro', f(s.man.bar), 'bar') : '') +
      (uP !== 'kgfcm2' ? tile('aire', 'Manómetro', f(s.man.kgfcm2), 'kgf/cm²') : '') + '</div>' +
      '<p class="ayuda" style="margin-top:10px">Debe comprobarse con una nueva medición con el dinamómetro antes de usarse. Basado en ' + s.n + ' pruebas de esta máquina, rubber y montaje; rango medido ' +
      f(s.xmin) + '–' + f(s.xmax) + ' psi de manómetro; R² = ' + f(s.r2, 3) + '.</p></div>';
    if (s.extrapola) html += aviso('peligro', 'Fuera del rango medido', 'El ajuste estimado está fuera de las presiones de manómetro que se midieron. La estimación no es confiable: mide nuevas pruebas cerca de este valor.');
    if (s.r2 < 0.95 && s.n >= 3) html += aviso('alerta', 'Datos dispersos', 'Las mediciones no siguen bien una línea (R² = ' + f(s.r2, 3) + '). Revisa repetibilidad, posición de la celda y estabilidad de la lectura.');
    out.innerHTML = html + htmlCapacidad(objetivo);
  }

  // ======================================================
  // 4. HISTORIAL Y REPORTES
  // ======================================================
  var ETIQUETAS = {
    id: 'ID', creado: 'Creado', modificado: 'Modificado', usuario_email: 'Usuario', fecha: 'Fecha',
    maquina_serie: 'Máquina (serie)', maquina_qr: 'QR', maquina_asset: 'Asset ID', maquina_linea: 'Línea en inventario', maquina_estacion: 'Estación',
    linea_operacion: 'Línea de operación',
    rubber_largo_cm: 'Largo rubber (cm)', rubber_ancho_cm: 'Ancho rubber (cm)', area_cm2: 'Área rubber (cm²)', area_in2: 'Área rubber (in²)',
    presion_deseada_psi: 'Presión deseada (psi)', fuerza_lbf: 'Fuerza (lbf)', fuerza_kgf: 'Fuerza (kgf)', fuerza_n: 'Fuerza (N)',
    capacidad_celda: 'Capacidad celda', observaciones: 'Observaciones',
    lectura_valor: 'Lectura dinamómetro', lectura_unidad: 'Unidad lectura',
    presion_psi: 'Presión prom. rubber (psi)', presion_kgfcm2: 'Presión prom. rubber (kgf/cm²)', presion_bar: 'Presión prom. rubber (bar)',
    plancha_largo_cm: 'Largo plancha (cm)', plancha_ancho_cm: 'Ancho plancha (cm)', plancha_area_cm2: 'Área plancha (cm²)',
    fuerza_total_plancha: 'Fuerza total sobre plancha', plancha_presion_psi: 'Presión prom. plancha (psi)',
    montaje: 'Montaje', manometro_valor: 'Manómetro (valor)', manometro_unidad: 'Unidad manómetro', manometro_psi: 'Manómetro (psi)',
    fuerza_valor: 'Fuerza dinamómetro (valor)', fuerza_unidad: 'Unidad fuerza',
    temperatura: 'Temperatura', temperatura_unidad: 'Unidad temperatura', tiempo_s: 'Tiempo de aplicación (s)'
  };
  var COLS_TABLA = {
    calculo_presion: ['fecha', 'maquina_serie', 'linea_operacion', 'rubber', 'presion_deseada_psi', 'fuerza_lbf', 'fuerza_kgf', 'fuerza_n', 'usuario_email', 'observaciones'],
    validacion_presion: ['fecha', 'maquina_serie', 'linea_operacion', 'rubber', 'lectura', 'fuerza_lbf', 'presion_psi', 'presion_kgfcm2', 'plancha_presion_psi', 'usuario_email', 'observaciones'],
    registro_pruebas: ['fecha', 'maquina_serie', 'linea_operacion', 'montaje', 'rubber', 'manometro', 'fuerza', 'fuerza_lbf', 'presion_psi', 'temperatura', 'tiempo_s', 'usuario_email', 'observaciones']
  };
  var ETQ_EXTRA = { rubber: 'Rubber cm', lectura: 'Lectura', manometro: 'Manómetro (aire)', fuerza: 'Fuerza leída' };

  function celdaTexto(r, c) {
    switch (c) {
      case 'fecha': return fechaLegible(r.fecha);
      case 'rubber': return f(num(r.rubber_largo_cm)) + ' × ' + f(num(r.rubber_ancho_cm));
      case 'lectura': return f(num(r.lectura_valor)) + ' ' + (r.lectura_unidad || '');
      case 'manometro': return f(num(r.manometro_valor)) + ' ' + (NOMBRE_PRES[r.manometro_unidad] || '');
      case 'fuerza': return f(num(r.fuerza_valor)) + ' ' + (r.fuerza_unidad || '');
      case 'temperatura': return r.temperatura === null || r.temperatura === undefined ? '—' : f(num(r.temperatura), 1) + ' ' + (r.temperatura_unidad || '');
      case 'tiempo_s': return r.tiempo_s ? f(num(r.tiempo_s), 1) : '—';
      case 'plancha_presion_psi': return r.plancha_presion_psi === null || r.plancha_presion_psi === undefined ? '—' : f(num(r.plancha_presion_psi));
      default:
        var v = r[c];
        if (v === null || v === undefined || v === '') return '—';
        return typeof v === 'number' ? f(v) : String(v);
    }
  }
  var TXT_COLS = { fecha: 1, maquina_serie: 1, maquina_linea: 1, linea_operacion: 1, montaje: 1, usuario_email: 1, observaciones: 1 };

  function registrosFiltrados(tabla) {
    var maq = $('#h-maquina').value;
    var q = $('#h-buscar').value.trim().toLowerCase();
    return DB.listar(tabla).filter(function (r) {
      if (maq && r.maquina_serie !== maq) return false;
      if (q && [r.maquina_serie, r.linea_operacion, r.maquina_linea, r.montaje, r.observaciones, r.usuario_email].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(b.creado || '').localeCompare(String(a.creado || '')); });
  }

  function renderAvisoHistorial() {
    var c = $('#h-aviso-bd');
    if (!DB.configurada()) c.innerHTML = aviso('info', 'Datos guardados solo en este teléfono', 'La base de datos en la nube no está configurada: los registros no se comparten entre teléfonos y se pueden perder si se borran los datos del navegador. Exporta o descarga respaldos con frecuencia.');
    else if (!DB.sesion()) c.innerHTML = aviso('alerta', 'Sin sesión', 'Ves solo los registros de este teléfono. Inicia sesión para ver los de todos y subir los pendientes.');
    else c.innerHTML = '';
  }

  function renderHistorial() {
    renderAvisoHistorial();
    $$('.segmentos button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mod === modHist ? 'true' : 'false'); });
    var s = $('#h-maquina'), actual = s.value, maqs = {};
    DB.listar(modHist).forEach(function (r) { maqs[r.maquina_serie] = r.maquina_linea || ''; });
    s.innerHTML = '<option value="">Todas las máquinas</option>' + Object.keys(maqs).sort().map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === actual ? ' selected' : '') + '>' + esc(m) + (maqs[m] ? ' · ' + esc(maqs[m]) : '') + '</option>';
    }).join('');
    var lista = registrosFiltrados(modHist);
    var total = DB.listar(modHist).length;
    $('#h-conteo').textContent = DB.TABLAS[modHist].nombre + ': ' + lista.length + ' de ' + total + ' registros.';
    if (!lista.length) {
      $('#h-tabla').innerHTML = vacio(total ? 'Ningún registro coincide con el filtro.' : 'Aún no hay registros en este módulo.');
      return;
    }
    $('#h-tabla').innerHTML = '<div class="reg-lista">' + lista.map(tarjeta).join('') + '</div><div class="tabla-historial tabla-scroll">' + tablaHTML(modHist, lista, true) + '</div>';
  }

  function puedeModificar(r) { return DB.esAdmin() || !r._srv; }
  function botonesFila(r) {
    if (!puedeModificar(r)) return '<span class="msg">Solo el administrador puede editar o eliminar.</span>';
    return (modHist === 'registro_pruebas' ? '<button class="btn btn-chico" data-acc="editar" data-id="' + esc(r.id) + '">Editar</button>' : '') +
      '<button class="btn btn-chico btn-peligro" data-acc="eliminar" data-id="' + esc(r.id) + '">Eliminar</button>';
  }
  function tarjeta(r) {
    var v;
    if (modHist === 'calculo_presion') v = [['tag-presion', 'Presión deseada', f(num(r.presion_deseada_psi)) + ' psi'], ['tag-fuerza', 'Fuerza', f(num(r.fuerza_lbf)) + ' lbf'], ['tag-fuerza', 'Fuerza', f(num(r.fuerza_kgf)) + ' kgf']];
    else if (modHist === 'validacion_presion') v = [['tag-fuerza', 'Lectura', f(num(r.lectura_valor)) + ' ' + esc(r.lectura_unidad)], ['tag-fuerza', 'Fuerza', f(num(r.fuerza_lbf)) + ' lbf'], ['tag-presion', 'Pres. rubber', f(num(r.presion_psi)) + ' psi']];
    else v = [['tag-aire', 'Manómetro', f(num(r.manometro_valor)) + ' ' + NOMBRE_PRES[r.manometro_unidad]], ['tag-fuerza', 'Fuerza', f(num(r.fuerza_valor)) + ' ' + esc(r.fuerza_unidad)], ['tag-presion', 'Pres. rubber', f(derivadosPrueba(r).presion.psi) + ' psi']];
    var extra = [];
    if (r.montaje) extra.push(esc(r.montaje));
    if (modHist === 'validacion_presion' && r.fuerza_total_plancha && r.plancha_presion_psi !== null) extra.push('Plancha ' + f(num(r.plancha_presion_psi)) + ' psi');
    if (modHist === 'registro_pruebas' && r.temperatura !== null && r.temperatura !== undefined) extra.push('Temp. ' + f(num(r.temperatura), 1) + ' ' + esc(r.temperatura_unidad || ''));
    if (modHist === 'registro_pruebas' && r.tiempo_s) extra.push('Tiempo ' + f(num(r.tiempo_s), 1) + ' s');
    if (r.usuario_email) extra.push(esc(r.usuario_email));
    var pend = r._pend && DB.configurada() ? '<span class="etq-pend">por subir</span>' : '';
    return '<article class="reg"><div class="reg-cab"><b>' + esc(r.maquina_serie) + pend + '</b><span>' + fechaLegible(r.fecha) + (r.creado ? ' ' + horaLegible(r.creado) : '') + '</span></div>' +
      '<div class="reg-meta">' + (r.linea_operacion ? 'Línea ' + esc(r.linea_operacion) : 'Línea no registrada') + ' · Rubber ' + f(num(r.rubber_largo_cm)) + ' × ' + f(num(r.rubber_ancho_cm)) + ' cm</div>' +
      '<div class="reg-vals">' + v.map(function (x) { return '<div class="' + x[0] + '">' + x[1] + '<strong>' + x[2] + '</strong></div>'; }).join('') + '</div>' +
      '<div class="reg-meta">' + extra.join(' · ') + (r.observaciones ? '<br>' + esc(r.observaciones) : '') + '</div>' +
      '<div class="acciones">' + botonesFila(r) + '</div></article>';
  }
  function tablaHTML(tabla, lista, conAcciones) {
    var cols = COLS_TABLA[tabla];
    var cab = cols.map(function (c) { return '<th class="' + (TXT_COLS[c] ? 'txt' : '') + '">' + esc(ETQ_EXTRA[c] || ETIQUETAS[c] || c) + '</th>'; }).join('');
    var filas = lista.map(function (r) {
      return '<tr>' + cols.map(function (c) { return '<td class="' + (c === 'observaciones' ? 'obs' : (TXT_COLS[c] ? 'txt' : '')) + '">' + esc(celdaTexto(r, c)) + (c === 'maquina_serie' && r._pend && DB.configurada() ? '<span class="etq-pend">por subir</span>' : '') + '</td>'; }).join('') +
        (conAcciones ? '<td><div class="acc-fila">' + botonesFila(r) + '</div></td>' : '') + '</tr>';
    }).join('');
    return '<table><thead><tr>' + cab + (conAcciones ? '<th>Acciones</th>' : '') + '</tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function eliminarRegistro(id) {
    var r = DB.obtener(modHist, id);
    if (!r) return;
    if (!puedeModificar(r)) { toast('Solo el administrador puede eliminar registros guardados en la nube.', true); return; }
    if (!confirm('¿Eliminar el registro de ' + r.maquina_serie + ' del ' + fechaLegible(r.fecha) + '? ' + (DB.configurada() ? 'También se eliminará de la base de datos en la nube.' : 'No se puede deshacer.'))) return;
    DB.eliminar(modHist, id);
    if (editId === id) cancelarEdicion();
    toast('Registro eliminado');
    renderHistorial();
  }

  // ---------- Exportación ----------
  function valorExport(c, v) {
    if (v === null || v === undefined) return '';
    if (c === 'creado' || c === 'modificado') return fechaHora(v);
    if (c === 'fecha') return String(v).slice(0, 10);
    if (c === 'fuerza_total_plancha') return v ? 'Sí' : 'No';
    if (c === 'manometro_unidad') return NOMBRE_PRES[v] || v;
    if (typeof v === 'number') return C.redondear(v, c === 'area_in2' ? 4 : 2);
    return v;
  }
  function filasExport(tabla, lista) {
    var cols = DB.TABLAS[tabla].columnas.filter(function (c) { return c !== 'id'; }).concat(['id']);
    var orden = ['fecha', 'maquina_serie', 'linea_operacion', 'maquina_linea', 'maquina_estacion', 'maquina_qr', 'maquina_asset'];
    cols = orden.concat(cols.filter(function (c) { return orden.indexOf(c) < 0; }));
    return [cols.map(function (c) { return ETIQUETAS[c] || c; })].concat(lista.map(function (r) {
      return cols.map(function (c) { return valorExport(c, r[c]); });
    }));
  }
  function aCSV(filas) {
    var celda = function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + filas.map(function (fl) { return fl.map(celda).join(','); }).join('\r\n');
  }
  function xlsxTodo() {
    var maq = $('#h-maquina').value;
    var hojas = Object.keys(DB.TABLAS).map(function (t) {
      var lista = DB.listar(t).filter(function (r) { return !maq || r.maquina_serie === maq; })
        .sort(function (a, b) { return String(b.creado).localeCompare(String(a.creado)); });
      return { nombre: DB.TABLAS[t].nombre, filas: filasExport(t, lista) };
    });
    hojas.push({ nombre: 'Información', filas: [
      ['Reporte', 'Medición Transfer — registros'], ['Generado', new Date().toLocaleString('es-HN')],
      ['Filtro de máquina', maq || 'todas'], ['Capacidad de la celda', textoCapacidad()],
      ['Base de datos', DB.configurada() ? (DB.sesion() ? 'Nube (' + DB.sesion().email + ')' : 'Nube sin sesión: solo registros de este teléfono') : 'Local (este teléfono)'],
      ['Aviso', TXT_PROMEDIO], ['Aviso', 'El manómetro mide presión del aire; el dinamómetro mide fuerza.'],
      ['Aviso', 'Confirma la capacidad y temperatura máxima de la celda antes de usarla.'],
      ['Aviso', 'No utilices los cálculos como ajuste de producción sin validar el montaje y los requisitos del proveedor del logo.']
    ] });
    return XlsxMini.crearXlsx(hojas);
  }
  function totalExportable() {
    var maq = $('#h-maquina').value;
    return Object.keys(DB.TABLAS).reduce(function (s, t) { return s + DB.listar(t).filter(function (r) { return !maq || r.maquina_serie === maq; }).length; }, 0);
  }
  function nombreArchivo(base, ext) { return base + '-' + hoyISO() + '.' + ext; }

  function imprimirReporte() {
    var lista = registrosFiltrados(modHist);
    if (!lista.length) { toast('No hay registros para imprimir.', true); return; }
    var maq = $('#h-maquina').value;
    var graficas = '';
    if (modHist === 'registro_pruebas') {
      var gs = gruposPruebas(lista);
      graficas = Object.keys(gs).slice(0, 6).map(function (k) { return '<h2>' + esc(etiquetaGrupo(gs[k])) + '</h2>' + graficasGrupo(gs[k]); }).join('');
    }
    $('#reporte').innerHTML = '<img class="logo-reporte" src="img/logo-color.png" alt="Pinehurst MFG"><h1>' + esc(DB.TABLAS[modHist].nombre) + ' — Máquinas Heat Transfer</h1>' +
      '<p>Generado: ' + esc(new Date().toLocaleString('es-HN')) + ' · Máquina: ' + esc(maq || 'todas') + ' · Registros: ' + lista.length +
      ' · Capacidad de la celda: ' + esc(textoCapacidad()) + '</p>' + AVISOS_HTML + '<h2>Registros</h2>' + tablaHTML(modHist, lista, false) + graficas;
    setTimeout(function () { window.print(); }, 50);
  }

  function respaldo() {
    var reg = {};
    Object.keys(DB.TABLAS).forEach(function (t) { reg[t] = DB.listar(t).map(function (r) { var o = {}; DB.TABLAS[t].columnas.forEach(function (c) { o[c] = r[c]; }); return o; }); });
    var data = { app: 'medicion-transfer', formato: 2, version: APP_VERSION, exportado: new Date().toISOString(), ajustes: ajustes, registros: reg };
    compartirArchivo(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), nombreArchivo('respaldo-transfer', 'json'), 'Respaldo Medición Transfer');
  }

  // ---------- Migración de la versión 1 ----------
  function convertirV1(r) {
    if (!r || !r.maquina || !(Number(r.largo) > 0) || !(Number(r.ancho) > 0) || !(Number(r.manValor) > 0) || !(Number(r.fuerzaValor) > 0)) return null;
    if (C.UNIDADES_PRESION.indexOf(r.manUnidad) < 0 || C.UNIDADES_FUERZA.indexOf(r.fuerzaUnidad) < 0) return null;
    var encontradas = buscarMaquinas(r.maquina);
    var m = encontradas.length === 1 ? encontradas[0] : { id: String(r.maquina).trim().slice(0, 60) };
    var base = {
      id: typeof r.id === 'string' ? r.id : undefined, creado: r.creado || null,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) ? r.fecha : hoyISO(), montaje: r.montaje || null,
      rubber_largo_cm: Number(r.largo), rubber_ancho_cm: Number(r.ancho),
      manometro_valor: Number(r.manValor), manometro_unidad: r.manUnidad, fuerza_valor: Number(r.fuerzaValor), fuerza_unidad: r.fuerzaUnidad,
      temperatura: r.temp === null || r.temp === undefined || r.temp === '' ? null : Number(r.temp),
      temperatura_unidad: r.temp === null || r.temp === undefined || r.temp === '' ? null : (r.tempUnidad === '°F' ? '°F' : '°C'),
      tiempo_s: Number(r.tiempo) > 0 ? Number(r.tiempo) : null, observaciones: r.obs || null
    };
    var d = derivadosPrueba(base);
    return Object.assign(datosMaquina(m), base, {
      area_cm2: r4(d.area.cm2), area_in2: r4(d.area.in2), manometro_psi: r4(d.manPsi),
      fuerza_lbf: r4(d.fuerza.lbf), fuerza_kgf: r4(d.fuerza.kgf), fuerza_n: r4(d.fuerza.N),
      presion_psi: r4(d.presion.psi), presion_kgfcm2: r4(d.presion.kgfcm2), presion_bar: r4(d.presion.bar)
    });
  }
  function migrarV1() {
    if (localStorage.getItem(LS_MIGR)) return;
    var viejos = leerLS(LS_V1, []);
    if (Array.isArray(viejos) && viejos.length) {
      var conv = viejos.map(convertirV1).filter(Boolean);
      if (conv.length) { DB.importar('registro_pruebas', conv); toast(conv.length + (conv.length === 1 ? ' prueba' : ' pruebas') + ' de la versión anterior pasaron a Registro de pruebas.'); }
    }
    localStorage.setItem(LS_MIGR, new Date().toISOString());
  }

  function validarFila(t, r) {
    if (!r || typeof r !== 'object' || !r.maquina_serie) return null;
    var o = {};
    DB.TABLAS[t].columnas.forEach(function (c) { o[c] = r[c] === undefined ? null : r[c]; });
    o.maquina_serie = String(o.maquina_serie).slice(0, 60);
    if (!(num(o.rubber_largo_cm) > 0) || !(num(o.rubber_ancho_cm) > 0)) return null;
    if (t === 'calculo_presion' && !(num(o.presion_deseada_psi) > 0)) return null;
    if (t === 'validacion_presion' && (!(num(o.lectura_valor) > 0) || C.UNIDADES_FUERZA.indexOf(o.lectura_unidad) < 0)) return null;
    if (t === 'registro_pruebas' && (!(num(o.manometro_valor) > 0) || !(num(o.fuerza_valor) > 0) ||
      C.UNIDADES_PRESION.indexOf(o.manometro_unidad) < 0 || C.UNIDADES_FUERZA.indexOf(o.fuerza_unidad) < 0)) return null;
    return o;
  }
  function importar(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    var lector = new FileReader();
    lector.onload = function () {
      var data;
      try { data = JSON.parse(lector.result); } catch (e) { toast('El archivo no es un respaldo válido.', true); return; }
      var porTabla = {};
      if (data && data.formato === 2 && data.registros) {
        Object.keys(DB.TABLAS).forEach(function (t) { porTabla[t] = (data.registros[t] || []).map(function (r) { return validarFila(t, r); }).filter(Boolean); });
      } else {
        var v1 = Array.isArray(data) ? data : data && data.registros;
        if (!Array.isArray(v1)) { toast('El archivo no contiene registros.', true); return; }
        porTabla.registro_pruebas = v1.map(convertirV1).filter(Boolean);
      }
      var total = Object.keys(porTabla).reduce(function (s, t) { return s + porTabla[t].length; }, 0);
      if (!total) { toast('No se encontraron registros válidos.', true); return; }
      if (!confirm('Se importarán ' + total + ' registros. Los que tengan el mismo identificador se reemplazarán. ¿Continuar?')) return;
      Object.keys(porTabla).forEach(function (t) { if (porTabla[t].length) DB.importar(t, porTabla[t]); });
      toast(total + ' registros importados.');
      renderHistorial();
    };
    lector.onerror = function () { toast('No se pudo leer el archivo.', true); };
    lector.readAsText(file);
  }

  // ======================================================
  // AJUSTES, SESIÓN E INSTALACIÓN
  // ======================================================
  var eventoInstalar = null;
  function abrirDialogo(d) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  function cerrarDialogo(d) { if (d.close) d.close(); else d.removeAttribute('open'); }

  function renderAjustesBD() {
    var c = $('#a-bd');
    if (!c) return;
    var s = DB.sesion(), cfg = DB.config();
    if (!DB.configurada()) c.innerHTML = '<p class="ayuda">Modo local: no hay base de datos en la nube configurada.</p>';
    else c.innerHTML = '<p class="ayuda">Supabase: <code>' + esc(cfg.url.replace(/^https?:\/\//, '')) + '</code> (' + esc(cfg.origen) + ')</p>' +
      (s ? '<p>Sesión: <b>' + esc(s.email) + '</b> · ' + (DB.esAdmin() ? 'Administrador' : 'Usuario general (agregar y consultar)') + '</p><div class="acciones"><button type="button" class="btn" data-accion="sync">Sincronizar</button><button type="button" class="btn btn-peligro" data-accion="logout">Cerrar sesión</button></div>'
        : '<div class="acciones"><button type="button" class="btn btn-primario" data-accion="login">Iniciar sesión</button></div>');
  }
  function abrirAjustes() {
    $('#a-cap').value = ajustes.capValor > 0 ? String(ajustes.capValor) : '';
    $('#a-cap-u').value = ajustes.capUnidad || 'lbf';
    var o = leerLS('transfer.nube.v1', {}) || {};
    $('#a-url').value = o.url || ''; $('#a-key').value = o.key || '';
    estadoCapacidad();
    renderAjustesBD();
    renderInstalar();
    abrirDialogo($('#dlg-ajustes'));
  }
  function estadoCapacidad() {
    var c = leer('a-cap'), el = $('#a-cap-estado');
    if (c.vacio) { el.textContent = 'Capacidad: no verificada.'; el.className = 'msg err'; }
    else if (c.ok) {
      var fz = C.fuerzaDesdeLbf(C.fuerzaALbf(c.v, $('#a-cap-u').value));
      el.textContent = 'Equivale a ' + f(fz.lbf) + ' lbf · ' + f(fz.kgf) + ' kgf · ' + f(fz.N) + ' N.'; el.className = 'msg ok';
    } else el.textContent = '';
  }
  function guardarAjustes() {
    var c = leer('a-cap');
    if (!c.ok) { $('#a-cap').focus(); return; }
    ajustes.capValor = c.v; ajustes.capUnidad = $('#a-cap-u').value;
    guardarLS(LS_AJ, ajustes);
    var url = $('#a-url').value.trim(), key = $('#a-key').value.trim();
    var o = leerLS('transfer.nube.v1', {}) || {};
    if (url !== (o.url || '') || key !== (o.key || '')) {
      if ((url && !key) || (!url && key)) { toast('Para la conexión avanzada se necesitan la URL y la clave.', true); return; }
      if (url && !/^https:\/\/.+/.test(url)) { toast('La URL de Supabase debe empezar con https://', true); return; }
      DB.guardarConfig(url, key);
      DB.cerrarSesion();
    }
    cerrarDialogo($('#dlg-ajustes'));
    toast('Ajustes guardados');
    recalcularTodo();
    DB.sincronizar();
  }
  function renderInstalar() {
    var cont = $('#a-instalar');
    var instalada = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (instalada) cont.innerHTML = '<p class="msg ok">La aplicación ya está instalada en este dispositivo.</p>';
    else if (eventoInstalar) cont.innerHTML = '<button type="button" class="btn btn-primario" id="a-btn-instalar">Instalar aplicación</button>';
    else cont.innerHTML = '';
    var b = $('#a-btn-instalar');
    if (b) b.addEventListener('click', function () { eventoInstalar.prompt(); eventoInstalar.userChoice.finally(function () { eventoInstalar = null; renderInstalar(); }); });
  }

  function abrirLogin() {
    if (!DB.configurada()) { toast('La base de datos en la nube no está configurada.', true); return; }
    var d = $('#dlg-ajustes');
    if (d.open) cerrarDialogo(d);
    $('#l-msg').textContent = '';
    modoLogin(!!DB.config().general);
    abrirDialogo($('#dlg-login'));
    setTimeout(function () { (DB.config().general ? $('#l-clave') : $('#l-email')).focus(); }, 50);
  }
  function modoLogin(general) {
    var g = DB.config().general;
    $('#l-email-campo').hidden = general;
    $('#l-otro').hidden = !general;
    $('#l-email').value = general ? g : '';
    $('#l-ayuda').textContent = general
      ? 'Escribe la contraseña general de planta. Solo se pide una vez en este teléfono.'
      : 'Usuario personal (administrador). Puede editar y eliminar registros.';
  }
  async function enviarLogin(ev) {
    ev.preventDefault();
    var email = $('#l-email').value.trim(), clave = $('#l-clave').value;
    var msg = $('#l-msg');
    if (!email || !clave) { msg.textContent = 'Ingresa correo y contraseña.'; msg.className = 'msg err'; return; }
    var b = $('#l-entrar');
    b.disabled = true; msg.textContent = 'Conectando…'; msg.className = 'msg';
    try {
      var e = await DB.iniciarSesion(email, clave);
      $('#l-clave').value = '';
      cerrarDialogo($('#dlg-login'));
      toast('Sesión iniciada: ' + e);
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
    finally { b.disabled = false; }
  }
  async function accionBD(accion) {
    if (accion === 'login') abrirLogin();
    if (accion === 'logout') {
      var pend = DB.pendientes();
      if (pend && !confirm('Hay ' + pend + ' registros sin subir. Quedarán guardados en este teléfono y se subirán cuando alguien inicie sesión. ¿Cerrar sesión?')) return;
      await DB.cerrarSesion(); toast('Sesión cerrada');
    }
    if (accion === 'sync') {
      var r = await DB.sincronizar();
      if (r.ok) toast('Sincronizado'); else if (r.motivo !== 'en-curso') toast(DB.estado().mensaje || 'No se pudo sincronizar', true);
    }
  }

  function recalcularTodo() { calcCalculo(); calcValidacion(); previewPrueba(); if (vistaActual === 'vista-pruebas') renderGraficas(); }

  // ======================================================
  // INICIO
  // ======================================================
  function iniciar() {
    restaurarCampos();
    $('#rp-fecha').value = hoyISO();
    $('#a-version').textContent = APP_VERSION;
    $('#a-maquinas').textContent = MAQ.length + ' máquinas Heat Transfer en el inventario';
    $$('[data-avisos]').forEach(function (d) { d.innerHTML = AVISOS_HTML; });
    $('#a-offline').textContent = 'Después de abrirla una vez con internet, las calculadoras, el escáner de QR, el guardado de registros y las exportaciones funcionan sin conexión. ' +
      'Los registros hechos sin señal quedan en el teléfono y se suben solos a la base de datos al volver la conexión. Se necesita internet para iniciar sesión, sincronizar, recibir actualizaciones y enviar archivos por correo o WhatsApp.';
    montarSelectores();
    migrarV1();

    // Navegación
    $$('[data-ir]').forEach(function (b) { b.addEventListener('click', function () { mostrarVista(b.dataset.ir); }); });
    $('#btn-inicio').addEventListener('click', function () { mostrarVista('vista-inicio'); });
    window.addEventListener('popstate', function () { mostrarVista(vistaDesdeHash(), { desdeHistorial: true }); });
    $('#estado-bd').addEventListener('click', function () {
      if (DB.configurada() && !DB.sesion()) abrirLogin();
      else if (DB.configurada()) accionBD('sync');
      else mostrarVista('vista-inicio');
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-accion]');
      if (b) accionBD(b.dataset.accion);
      var q = e.target.closest('[data-qr]');
      if (q) abrirQR(q.dataset.qr);
    });

    // Validación al salir de un campo
    $$('input[data-req]').forEach(function (el) { el.addEventListener('blur', function () { leer(el.id, false); }); });

    // Cálculo de presión
    ['cp-largo', 'cp-ancho', 'cp-psi'].forEach(function (id) { $('#' + id).addEventListener('input', function () { recordar(id); calcCalculo(); }); });
    $('#cp-guardar').addEventListener('click', guardarCalculo);
    $('#cp-compartir').addEventListener('click', compartirCalculo);

    // Validación de presión
    ['vp-largo', 'vp-ancho', 'vp-lectura', 'vp-unidad', 'vp-pl-largo', 'vp-pl-ancho'].forEach(function (id) {
      $('#' + id).addEventListener($('#' + id).tagName === 'SELECT' ? 'change' : 'input', function () { recordar(id); calcValidacion(); });
    });
    $('#vp-pl-total').addEventListener('change', calcPlancha);
    $('#vp-guardar').addEventListener('click', guardarValidacion);
    $('#vp-compartir').addEventListener('click', compartirValidacion);
    $('#vp-a-pruebas').addEventListener('click', validacionAPruebas);

    // Registro de pruebas
    $('#form-pruebas').addEventListener('submit', guardarPrueba);
    ['rp-largo', 'rp-ancho', 'rp-man', 'rp-fuerza'].forEach(function (id) { $('#' + id).addEventListener('input', previewPrueba); });
    ['rp-man-u', 'rp-fuerza-u', 'rp-temp-u'].forEach(function (id) { $('#' + id).addEventListener('change', function () { recordar(id); previewPrueba(); }); });
    ['rp-largo', 'rp-ancho', 'rp-montaje'].forEach(function (id) { $('#' + id).addEventListener('change', function () { alCambiarMaquina('rp'); }); });
    $('#rp-cancelar').addEventListener('click', function () { cancelarEdicion(); });
    $('#rp-limpiar').addEventListener('click', function () { if (editId) cancelarEdicion(); else limpiarFormulario(); });
    $('#g-grupo').addEventListener('change', function () { grupoSel = this.value; renderGraficas(); });
    $('#s-psi').addEventListener('input', function () { recordar('s-psi'); renderSugerencia(); });

    // Historial
    $$('.segmentos button').forEach(function (b) { b.addEventListener('click', function () { modHist = b.dataset.mod; $('#h-maquina').value = ''; renderHistorial(); }); });
    $('#h-maquina').addEventListener('change', renderHistorial);
    $('#h-buscar').addEventListener('input', renderHistorial);
    $('#h-tabla').addEventListener('click', function (e) {
      var b = e.target.closest('[data-acc]');
      if (!b) return;
      if (b.dataset.acc === 'editar') editarPrueba(b.dataset.id);
      if (b.dataset.acc === 'eliminar') eliminarRegistro(b.dataset.id);
    });
    $('#h-xlsx').addEventListener('click', function () { if (!totalExportable()) return toast('No hay registros para exportar.', true); descargar(xlsxTodo(), nombreArchivo('registros-transfer', 'xlsx')); });
    $('#h-compartir').addEventListener('click', function () { if (!totalExportable()) return toast('No hay registros para exportar.', true); compartirArchivo(xlsxTodo(), nombreArchivo('registros-transfer', 'xlsx'), 'Registros Medición Transfer'); });
    $('#h-csv').addEventListener('click', function () {
      var l = registrosFiltrados(modHist);
      if (!l.length) return toast('No hay registros para exportar.', true);
      descargar(new Blob([aCSV(filasExport(modHist, l))], { type: 'text/csv;charset=utf-8' }), nombreArchivo(modHist.replace('_', '-'), 'csv'));
    });
    $('#h-pdf').addEventListener('click', imprimirReporte);
    $('#h-respaldo').addEventListener('click', respaldo);
    $('#h-importar').addEventListener('change', importar);
    $('label[for="h-importar"]').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#h-importar').click(); } });

    // Diálogos
    $('#btn-ajustes').addEventListener('click', abrirAjustes);
    $('#a-cap').addEventListener('input', estadoCapacidad);
    $('#a-cap-u').addEventListener('change', estadoCapacidad);
    $('#a-guardar').addEventListener('click', guardarAjustes);
    $('#qr-cerrar').addEventListener('click', cerrarQR);
    $('#dlg-qr').addEventListener('close', detenerCamara);
    $('#form-login').addEventListener('submit', enviarLogin);
    $('#l-cancelar').addEventListener('click', function () { cerrarDialogo($('#dlg-login')); });
    $('#l-otro').addEventListener('click', function () { modoLogin(false); $('#l-email').focus(); });

    // Base de datos, red e instalación
    DB.alCambiar(function () {
      renderEstadoBD();
      if (vistaActual === 'vista-historial') renderHistorial();
      if (vistaActual === 'vista-pruebas' && !editId) renderGraficas();
    });
    window.addEventListener('online', renderEstadoBD);
    window.addEventListener('offline', renderEstadoBD);
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); eventoInstalar = e; });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(function () {});

    calcCalculo(); calcValidacion(); previewPrueba();
    var inicial = vistaDesdeHash();
    if (inicial !== 'vista-inicio') {
      try { history.replaceState({ vista: 'vista-inicio' }, '', location.pathname + location.search); } catch (e) { /* nada */ }
      mostrarVista(inicial, { sinScroll: true });
    } else mostrarVista('vista-inicio', { reemplazar: true, sinScroll: true });
    renderEstadoBD();
    DB.sincronizar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
