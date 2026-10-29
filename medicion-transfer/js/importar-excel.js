/*
 * importar-excel.js — Lee "Parametros de Trims" (.xlsx) y prepara la importación al catálogo.
 * - Lee el archivo en el navegador (sin enviarlo a ningún servidor externo).
 * - Identifica columnas por su encabezado (su posición cambia entre hojas).
 * - Recupera imágenes flotantes (dibujos) y las incrustadas en celdas (las que Excel muestra como #VALUE!).
 * - No inventa datos: lo que falta queda vacío y se informa.
 * El Excel no es una dependencia: después de importar, todo vive en la base de datos.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // ZIP (el .xlsx es un ZIP)
  // ------------------------------------------------------------------
  async function inflar(datos) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([datos]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function abrirZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('El archivo no es un Excel .xlsx válido.');
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder();
    var entradas = {};
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('Directorio del archivo dañado.');
      var metodo = dv.getUint16(off + 10, true), tam = dv.getUint32(off + 20, true);
      var ln = dv.getUint16(off + 28, true), le = dv.getUint16(off + 30, true), lc = dv.getUint16(off + 32, true);
      var local = dv.getUint32(off + 42, true);
      var nombre = dec.decode(u8.subarray(off + 46, off + 46 + ln));
      entradas[nombre] = { metodo: metodo, tam: tam, local: local };
      off += 46 + ln + le + lc;
    }
    return {
      existe: function (p) { return !!entradas[p]; },
      nombres: function () { return Object.keys(entradas); },
      bytes: async function (p) {
        var e = entradas[p];
        if (!e) return null;
        var l = e.local;
        var ini = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
        var datos = u8.subarray(ini, ini + e.tam);
        if (e.metodo === 0) return datos.slice();
        if (e.metodo === 8) return inflar(datos);
        throw new Error('Compresión no admitida en ' + p);
      },
      texto: async function (p) { var b = await this.bytes(p); return b ? dec.decode(b) : null; }
    };
  }

  // ------------------------------------------------------------------
  // Utilidades XML y rutas
  // ------------------------------------------------------------------
  function xml(t) { return new DOMParser().parseFromString(t, 'application/xml'); }
  function hijos(nodo, nombre) { return Array.prototype.slice.call(nodo.getElementsByTagNameNS('*', nombre)); }
  function hijo(nodo, nombre) { return nodo.getElementsByTagNameNS('*', nombre)[0] || null; }
  function attrR(nodo, nombre) {
    return nodo.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', nombre) || nodo.getAttribute('r:' + nombre);
  }
  function resolver(base, rel) {
    if (rel.charAt(0) === '/') return rel.slice(1);
    var partes = base.split('/'); partes.pop();
    rel.split('/').forEach(function (p) { if (p === '..') partes.pop(); else if (p !== '.') partes.push(p); });
    return partes.join('/');
  }
  function rutaRels(p) { var i = p.lastIndexOf('/'); return p.slice(0, i) + '/_rels/' + p.slice(i + 1) + '.rels'; }
  async function leerRels(zip, p) {
    var t = await zip.texto(rutaRels(p));
    var m = {};
    if (!t) return m;
    hijos(xml(t), 'Relationship').forEach(function (r) {
      m[r.getAttribute('Id')] = { destino: r.getAttribute('TargetMode') === 'External' ? null : resolver(p, r.getAttribute('Target')), tipo: r.getAttribute('Type') };
    });
    return m;
  }
  function colNum(letras) { var n = 0; for (var i = 0; i < letras.length; i++) n = n * 26 + letras.charCodeAt(i) - 64; return n; }
  function colLetras(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function sinAcentos(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function norm(s) { return sinAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function limpio(s) { return s === null || s === undefined ? null : (String(s).replace(/\s+/g, ' ').trim() || null); }

  // ------------------------------------------------------------------
  // Lectura del libro
  // ------------------------------------------------------------------
  var FORMATOS_FECHA = { 14: 1, 15: 1, 16: 1, 17: 1, 22: 1, 27: 1, 30: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 57: 1 };
  function serialAFecha(n) {
    var ms = Math.round((n - 25569) * 86400000);
    var d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  async function leerEstilos(zip) {
    var t = await zip.texto('xl/styles.xml');
    var esFecha = [];
    if (!t) return esFecha;
    var d = xml(t), propios = {};
    hijos(d, 'numFmt').forEach(function (n) { propios[n.getAttribute('numFmtId')] = n.getAttribute('formatCode') || ''; });
    var xfs = hijo(d, 'cellXfs');
    if (!xfs) return esFecha;
    Array.prototype.slice.call(xfs.children).forEach(function (xf) {
      var id = Number(xf.getAttribute('numFmtId') || 0);
      var codigo = propios[id];
      esFecha.push(!!FORMATOS_FECHA[id] || (!!codigo && /[dy]/i.test(codigo.replace(/"[^"]*"|\[[^\]]*\]/g, ''))));
    });
    return esFecha;
  }

  /** Imágenes incrustadas en celdas (Excel 365 "Colocar en celda"): vm → imagen. */
  async function leerImagenesEnCelda(zip) {
    var porVm = {};
    var meta = await zip.texto('xl/metadata.xml');
    var rv = await zip.texto('xl/richData/rdrichvalue.xml');
    var rel = await zip.texto('xl/richData/richValueRel.xml');
    if (!meta || !rv || !rel) return porVm;
    var est = await zip.texto('xl/richData/rdrichvaluestructure.xml');
    var posLocal = {};
    if (est) {
      hijos(xml(est), 's').forEach(function (s, i) {
        hijos(s, 'k').forEach(function (k, j) { if (/LocalImageIdentifier/i.test(k.getAttribute('n'))) posLocal[i] = j; });
      });
    }
    var dm = xml(meta);
    var futuras = [];
    var fm = hijos(dm, 'futureMetadata').find(function (x) { return x.getAttribute('name') === 'XLRICHVALUE'; });
    if (fm) hijos(fm, 'bk').forEach(function (bk) { var r = hijo(bk, 'rvb'); futuras.push(r ? Number(r.getAttribute('i')) : null); });
    var tipos = hijos(dm, 'metadataType').map(function (m) { return m.getAttribute('name'); });
    var vmeta = hijo(dm, 'valueMetadata');
    var valores = hijos(xml(rv), 'rv');
    var relsLista = hijos(xml(rel), 'rel').map(function (r) { return attrR(r, 'id'); });
    var relsArchivo = await leerRels(zip, 'xl/richData/richValueRel.xml');
    if (!vmeta) return porVm;
    hijos(vmeta, 'bk').forEach(function (bk, i) {
      var rc = hijo(bk, 'rc');
      if (!rc) return;
      if (tipos[Number(rc.getAttribute('t')) - 1] !== 'XLRICHVALUE') return;
      var idxRv = futuras[Number(rc.getAttribute('v'))];
      var valor = valores[idxRv];
      if (!valor) return;
      var vs = hijos(valor, 'v');
      var pos = posLocal[Number(valor.getAttribute('s'))];
      var v = vs[pos === undefined ? 0 : pos];
      if (!v) return;
      var rid = relsLista[Number(v.textContent)];
      var destino = rid && relsArchivo[rid] ? relsArchivo[rid].destino : null;
      if (destino) porVm[i + 1] = destino;
    });
    return porVm;
  }

  async function leerDibujos(zip, rutaHoja, relsHoja) {
    var res = { imagenes: [], formas: 0 };
    var ids = Object.keys(relsHoja).filter(function (k) { return /\/drawing$/.test(relsHoja[k].tipo); });
    for (var i = 0; i < ids.length; i++) {
      var rutaDib = relsHoja[ids[i]].destino;
      var t = await zip.texto(rutaDib);
      if (!t) continue;
      var relsDib = await leerRels(zip, rutaDib);
      var d = xml(t);
      var anclas = hijos(d, 'twoCellAnchor').concat(hijos(d, 'oneCellAnchor'), hijos(d, 'absoluteAnchor'));
      anclas.forEach(function (a) {
        var pics = hijos(a, 'pic');
        var desde = hijo(a, 'from');
        if (!pics.length) { res.formas++; return; }
        pics.forEach(function (pic) {
          var blip = hijo(pic, 'blip');
          var rid = blip ? attrR(blip, 'embed') : null;
          var destino = rid && relsDib[rid] ? relsDib[rid].destino : null;
          var nv = hijo(pic, 'cNvPr');
          res.imagenes.push({
            fila: desde ? Number(hijo(desde, 'row').textContent) + 1 : null,
            col: desde ? Number(hijo(desde, 'col').textContent) + 1 : null,
            media: destino, nombre: nv ? nv.getAttribute('name') : ''
          });
        });
      });
    }
    return res;
  }

  async function leerLibro(buf) {
    var zip = abrirZip(buf);
    if (!zip.existe('xl/workbook.xml')) throw new Error('El archivo no parece un libro de Excel (.xlsx).');
    var compartidas = [];
    var ss = await zip.texto('xl/sharedStrings.xml');
    if (ss) hijos(xml(ss), 'si').forEach(function (si) { compartidas.push(hijos(si, 't').map(function (t) { return t.textContent; }).join('')); });
    var esFecha = await leerEstilos(zip);
    var enCelda = await leerImagenesEnCelda(zip);
    var relsLibro = await leerRels(zip, 'xl/workbook.xml');
    var hojas = [];
    var dl = xml(await zip.texto('xl/workbook.xml'));
    var lista = hijos(dl, 'sheet');
    for (var i = 0; i < lista.length; i++) {
      var sh = lista[i];
      var nombre = sh.getAttribute('name');
      var r = relsLibro[attrR(sh, 'id')];
      if (!r || !r.destino) continue;
      var t = await zip.texto(r.destino);
      var celdas = {};
      var dh = xml(t);
      hijos(dh, 'c').forEach(function (c) {
        var ref = c.getAttribute('r');
        var m = /^([A-Z]+)(\d+)$/.exec(ref || '');
        if (!m) return;
        var tipo = c.getAttribute('t'), v = hijo(c, 'v'), vm = c.getAttribute('vm');
        var val = null, error = null, fecha = false;
        if (tipo === 's') val = v ? compartidas[Number(v.textContent)] : null;
        else if (tipo === 'inlineStr') val = hijos(c, 't').map(function (x) { return x.textContent; }).join('');
        else if (tipo === 'str') val = v ? v.textContent : null;
        else if (tipo === 'b') val = v ? v.textContent === '1' : null;
        else if (tipo === 'e') error = v ? v.textContent : '#ERROR';
        else if (v) {
          val = Number(v.textContent);
          if (esFecha[Number(c.getAttribute('s') || 0)]) { val = serialAFecha(val); fecha = true; }
        }
        var imagen = vm && enCelda[Number(vm)] ? enCelda[Number(vm)] : null;
        if (val === null && error === null && !imagen) return;
        celdas[ref] = { fila: Number(m[2]), col: colNum(m[1]), valor: val, error: imagen ? null : error, imagen: imagen, fecha: fecha };
      });
      var relsHoja = await leerRels(zip, r.destino);
      var dib = await leerDibujos(zip, r.destino, relsHoja);
      hojas.push({ nombre: nombre, celdas: celdas, dibujos: dib.imagenes, formas: dib.formas });
    }
    return { zip: zip, hojas: hojas };
  }

  // ------------------------------------------------------------------
  // Interpretación de las hojas de clientes
  // ------------------------------------------------------------------
  var CAMPOS = [
    ['largo', /^largo/], ['ancho', /^ancho/],
    ['fecha', /^fecha/], ['tela', /tela/], ['codigo', /codigo/], ['proveedor', /proveedor/],
    ['referencia', /referencia/], ['desprendimiento', /desprendimiento|peel/], ['temperatura', /temperatura/],
    ['presion', /presion/], ['tiempo', /tiempo/], ['rubber', /rubber|ruber|molde/], ['observaciones', /observacion|comentario|nota/]
  ];
  function detectarEncabezado(hoja) {
    var porFila = {};
    Object.keys(hoja.celdas).forEach(function (k) { var c = hoja.celdas[k]; (porFila[c.fila] = porFila[c.fila] || []).push(c); });
    var filas = Object.keys(porFila).map(Number).sort(function (a, b) { return a - b; }).slice(0, 15);
    for (var i = 0; i < filas.length; i++) {
      var mapa = {}, textos = {};
      porFila[filas[i]].forEach(function (c) {
        if (typeof c.valor !== 'string') return;
        var n = norm(c.valor);
        var campo = CAMPOS.find(function (x) { return x[1].test(n); });
        if (campo && !mapa[campo[0]]) { mapa[campo[0]] = c.col; textos[campo[0]] = c.valor.trim(); }
      });
      if (mapa.codigo && Object.keys(mapa).length >= 4) return { fila: filas[i], columnas: mapa, textos: textos };
    }
    return null;
  }

  function nombreCliente(hoja) {
    var s = String(hoja).replace(/\s+/g, ' ').trim();
    if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|\s)\S/g, function (x) { return x.toUpperCase(); });
    return s;
  }
  function claveCodigo(s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); }
  function claveTela(s) { return norm(s).replace(/\s+/g, '').replace(/\//g, '-').replace(/-+/g, '-'); }
  /** Divide "100% Polyester/ 67% Polyester-33% cotton" en dos telas solo si cada parte suma 100 %. */
  function dividirTelas(texto) {
    var t = limpio(texto);
    if (!t) return [];
    var partes = t.split('/').map(function (p) { return p.trim(); }).filter(Boolean);
    if (partes.length < 2) return [t];
    var suma = function (p) { return (p.match(/\d+(?:[.,]\d+)?\s*%/g) || []).reduce(function (s, x) { return s + parseFloat(x); }, 0); };
    var todas = partes.every(function (p) { return Math.abs(suma(p) - 100) < 0.5; });
    return todas ? partes : [t];
  }
  function tipoDesprendimiento(t) {
    var n = norm(t);
    if (!n) return null;
    if (/fri|cold/.test(n)) return 'frio';
    if (/calient|hot|warm/.test(n)) return 'caliente';
    return 'otro';
  }
  function fechaTexto(c) {
    if (!c) return { fecha: null, texto: null, dudosa: false };
    if (c.fecha) {
      var anio = Number(String(c.valor).slice(0, 4));
      return { fecha: c.valor, texto: c.valor, dudosa: anio < 2000 || anio > 2100 };
    }
    var t = limpio(c.valor);
    if (!t) return { fecha: null, texto: null, dudosa: false };
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) {
      var a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
      if (y >= 2000 && y <= 2100) {
        if (a > 12 && b <= 12) return { fecha: y + '-' + String(b).padStart(2, '0') + '-' + String(a).padStart(2, '0'), texto: t, dudosa: false };
        if (b > 12 && a <= 12) return { fecha: y + '-' + String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0'), texto: t, dudosa: false };
      }
    }
    return { fecha: null, texto: t, dudosa: true };
  }

  /**
   * Extrae las filas de todas las hojas de clientes.
   * Devuelve { filas, hojasExcluidas, sueltas, avisosGenerales, medios: { ruta: true } }.
   */
  function extraer(libro) {
    var filas = [], excluidas = [], sueltas = [], medios = {}, generales = [];
    libro.hojas.forEach(function (hoja) {
      var enc = detectarEncabezado(hoja);
      var nCeldas = Object.keys(hoja.celdas).length;
      if (!enc) {
        excluidas.push({ hoja: hoja.nombre, motivo: nCeldas ? 'No tiene la fila de encabezados (Código del accesorio, Presión…): hoja auxiliar.' : 'Hoja vacía.',
          imagenes: hoja.dibujos.length });
        hoja.dibujos.forEach(function (d) { if (d.media) sueltas.push({ hoja: hoja.nombre, celda: colLetras(d.col) + d.fila, media: d.media, motivo: 'Hoja excluida' }); });
        return;
      }
      var C = enc.columnas;
      var cel = function (f, campo) { return C[campo] ? hoja.celdas[colLetras(C[campo]) + f] || null : null; };
      var imgsEn = function (f, col) {
        var l = [];
        hoja.dibujos.forEach(function (d) { if (d.fila === f && d.col === col && d.media) l.push({ media: d.media, origen: 'dibujo', celda: colLetras(col) + f }); });
        var c = hoja.celdas[colLetras(col) + f];
        if (c && c.imagen) l.unshift({ media: c.imagen, origen: 'celda', celda: colLetras(col) + f });
        return l;
      };
      var maxFila = 0;
      Object.keys(hoja.celdas).forEach(function (k) { maxFila = Math.max(maxFila, hoja.celdas[k].fila); });
      hoja.dibujos.forEach(function (d) { maxFila = Math.max(maxFila, d.fila || 0); });
      var usados = {};
      var colsConocidas = {};
      Object.keys(C).forEach(function (k) { colsConocidas[C[k]] = k; });
      var hojaFilas = 0;
      for (var f = enc.fila + 1; f <= maxFila; f++) {
        var cc = cel(f, 'codigo');
        var codigo = cc ? limpio(cc.valor === null ? null : String(cc.valor)) : null;
        var hayDatos = Object.keys(C).some(function (k) { var x = cel(f, k); return x && (x.valor !== null || x.imagen); });
        if (!codigo) {
          if (hayDatos) generales.push({ nivel: 'aviso', texto: hoja.nombre + ' fila ' + f + ': tiene datos pero no tiene código del accesorio; no se importa.' });
          continue;
        }
        hojaFilas++;
        var avisos = [];
        var txt = function (campo) {
          var x = cel(f, campo);
          if (!x) return null;
          if (x.error) { avisos.push({ nivel: 'error', texto: 'Celda ' + colLetras(C[campo]) + f + ' (' + enc.textos[campo] + ') tiene un error de Excel ' + x.error + '; se deja vacía.' }); return null; }
          return x.valor === null ? null : limpio(String(x.valor));
        };
        var crudo = function (campo) { var x = cel(f, campo); return x && !x.error ? x.valor : null; };
        var imgRef = C.referencia ? imgsEn(f, C.referencia) : [];
        var imgRub = C.rubber ? imgsEn(f, C.rubber) : [];
        imgRef.concat(imgRub).forEach(function (im) { usados[im.media + '@' + im.celda] = 1; medios[im.media] = 1; });
        imgRef.concat(imgRub).forEach(function (im) {
          if (im.origen === 'celda') avisos.push({ nivel: 'info', texto: 'Celda ' + im.celda + ' muestra #VALUE! pero contiene una imagen incrustada: se recuperó.' });
        });
        if (imgRef.length > 1) avisos.push({ nivel: 'aviso', texto: 'La celda ' + imgRef[0].celda + ' tiene ' + imgRef.length + ' imágenes; la primera queda como principal y las demás como adicionales.' });
        if (imgRub.length > 1) avisos.push({ nivel: 'aviso', texto: 'La celda ' + imgRub[0].celda + ' tiene ' + imgRub.length + ' imágenes de rubber; la primera queda como principal y las demás como adicionales.' });

        var fe = fechaTexto(cel(f, 'fecha'));
        if (fe.dudosa) avisos.push({ nivel: 'aviso', texto: 'Fecha dudosa "' + fe.texto + '": se conserva el texto y la fecha queda vacía.' });

        var telaTxt = txt('tela');
        var telas = dividirTelas(telaTxt);
        if (telas.length > 1) avisos.push({ nivel: 'aviso', texto: 'La tela "' + telaTxt + '" se dividió en ' + telas.length + ' telas (cada una suma 100 %); se crea una configuración por tela con los mismos parámetros.' });
        if (!C.tela) avisos.push({ nivel: 'info', texto: 'Esta hoja no tiene columna de tipo de tela.' });
        else if (!telaTxt) avisos.push({ nivel: 'aviso', texto: 'Falta el tipo de tela.' });

        var presTxt = txt('presion');
        var pres = presTxt ? Calc.parseRango(presTxt) : null;
        if (!presTxt) avisos.push({ nivel: 'aviso', texto: 'Falta la presión.' });
        else if (!pres) avisos.push({ nivel: 'aviso', texto: 'Presión "' + presTxt + '" no reconocida como número o rango; se conserva el texto.' });
        else if (pres.unidad && pres.unidad !== 'psi') avisos.push({ nivel: 'aviso', texto: 'La presión dice "' + pres.unidad + '", no psi; revisar.' });
        else if (pres.invertido) avisos.push({ nivel: 'aviso', texto: 'El rango de presión "' + presTxt + '" está escrito al revés; se toma ' + pres.min + '–' + pres.max + '.' });

        var tempTxt = txt('temperatura');
        var temp = tempTxt ? Calc.parseRango(tempTxt) : null;
        var unidadEnc = /°\s*c|ºc|\(c\)/i.test(enc.textos.temperatura || '') ? '°C' : /°\s*f|ºf|\(f\)/i.test(enc.textos.temperatura || '') ? '°F' : null;
        var tempUnidad = (temp && (temp.unidad === '°C' || temp.unidad === '°F')) ? temp.unidad : unidadEnc;
        if (tempTxt && !tempUnidad) avisos.push({ nivel: 'info', texto: 'La temperatura no indica unidad (°C o °F); queda pendiente.' });
        if (tempTxt && !temp) avisos.push({ nivel: 'aviso', texto: 'Temperatura "' + tempTxt + '" no reconocida como número o rango; se conserva el texto.' });

        var obs = txt('observaciones'), internas = null;
        if (obs && /par[aá]metros?\s+(usados|utilizados)/i.test(obs)) { internas = obs; obs = null; avisos.push({ nivel: 'info', texto: 'El comentario contiene parámetros usados en pruebas internas; se guarda aparte y no reemplaza los del proveedor.' }); }
        else if (obs && /segund|pasada|lado/i.test(obs)) avisos.push({ nivel: 'info', texto: 'La observación describe una secuencia de aplicación; se conserva tal cual, sin cambiar el tiempo.' });

        var prov = txt('proveedor');
        if (prov && /\b[A-Z]{2,}-[A-Z]{2,}-\d+\b/.test(prov)) avisos.push({ nivel: 'aviso', texto: 'El proveedor "' + prov + '" parece contener un código de accesorio; revisar.' });

        var rubTxt = txt('rubber');
        if (!imgRub.length && !rubTxt) avisos.push({ nivel: 'aviso', texto: 'Falta el rubber o molde.' });
        var largo = crudo('largo'), ancho = crudo('ancho');
        largo = typeof largo === 'number' && largo > 0 ? largo : (typeof largo === 'string' ? Calc.parseNumero(largo) : null);
        ancho = typeof ancho === 'number' && ancho > 0 ? ancho : (typeof ancho === 'string' ? Calc.parseNumero(ancho) : null);
        if (!(largo > 0)) largo = null;
        if (!(ancho > 0)) ancho = null;
        if (!largo || !ancho) avisos.push({ nivel: 'aviso', texto: 'Faltan dimensiones del rubber (largo y ancho); se completan en administración.' });

        var tiempo = txt('tiempo');
        var desp = txt('desprendimiento');
        var refTxt = txt('referencia');
        if (!refTxt && !imgRef.length) avisos.push({ nivel: 'aviso', texto: 'Sin descripción ni imagen de la referencia.' });

        filas.push({
          hoja: hoja.nombre, fila: f, cliente: nombreCliente(hoja.nombre), codigo: codigo,
          proveedor: prov, referencia: refTxt, imagenesRef: imgRef.map(function (x) { return x.media; }),
          telas: telas.length ? telas : [null],
          desprendimiento: tipoDesprendimiento(desp), desprendimiento_texto: desp,
          temperatura_texto: tempTxt, temperatura_min: temp ? temp.min : null, temperatura_max: temp ? temp.max : null, temperatura_unidad: tempUnidad,
          presion_texto: presTxt, presion_min_psi: pres ? pres.min : null, presion_max_psi: pres ? pres.max : null,
          tiempo_texto: tiempo, rubber_texto: rubTxt, imagenesRub: imgRub.map(function (x) { return x.media; }),
          largo_cm: largo, ancho_cm: ancho, observaciones: obs, pruebas_internas: internas,
          fecha: fe.fecha, fecha_texto: fe.texto, avisos: avisos
        });
      }
      if (!hojaFilas) excluidas.push({ hoja: hoja.nombre, motivo: 'Tiene encabezados pero ninguna fila con código.', imagenes: hoja.dibujos.length });
      hoja.dibujos.forEach(function (d) {
        if (!d.media) return;
        var celda = colLetras(d.col) + d.fila;
        if (usados[d.media + '@' + celda]) return;
        var col = colsConocidas[d.col];
        sueltas.push({ hoja: hoja.nombre, celda: celda, media: d.media,
          motivo: col ? 'Está en la columna ' + enc.textos[col] + ', que no lleva imágenes en el catálogo' : 'Está fuera de las columnas con encabezado' });
      });
      if (hoja.formas) generales.push({ nivel: 'info', texto: hoja.nombre + ': ' + hoja.formas + ' formas o anotaciones dibujadas (rectángulos, flechas) no se importan.' });
    });
    sueltas.forEach(function (s) { medios[s.media] = 1; });
    return { filas: filas, excluidas: excluidas, sueltas: sueltas, generales: generales, medios: Object.keys(medios) };
  }

  // ------------------------------------------------------------------
  // Plan de importación contra el catálogo actual (sin escribir nada)
  // ------------------------------------------------------------------
  var CAMPOS_CONFIG = ['proveedor_id', 'temperatura_texto', 'temperatura_min', 'temperatura_max', 'temperatura_unidad', 'presion_texto',
    'presion_min_psi', 'presion_max_psi', 'tiempo_texto', 'desprendimiento', 'desprendimiento_texto', 'observaciones', 'pruebas_internas',
    'fecha_texto', 'fecha', 'origen'];

  /**
   * ext: resultado de extraer(); rutas: { media: rutaEnStorage|null }; cat: catálogo actual; nuevoId: fn.
   * Devuelve listas por tabla con { estado: 'nuevo'|'igual'|'cambio', fila, antes, cambios: [{campo, antes, despues}] }.
   */
  function planificar(ext, rutas, cat, nuevoId) {
    var plan = { cat_clientes: [], cat_proveedores: [], cat_telas: [], cat_accesorios: [], cat_rubbers: [], cat_configuraciones: [], duplicados: [] };
    var porClave = {};
    function existente(t, clave, alterno) {
      return cat[t].find(function (x) { return x.clave_import === clave; }) || (alterno ? cat[t].find(alterno) : null);
    }
    function igualV(a, b) {
      if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
      if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
      if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
      return String(a) === String(b);
    }
    /** Registra una entidad; si ya existe, compara solo los campos que el Excel trae con valor. */
    function poner(t, clave, datos, alterno, extra) {
      var k = t + '|' + clave;
      if (porClave[k]) return porClave[k];
      var prev = existente(t, clave, alterno);
      var item;
      if (!prev) {
        item = { estado: 'nuevo', fila: Object.assign({ id: nuevoId(), clave_import: clave, activo: true }, datos), antes: null, cambios: [] };
      } else {
        var cambios = [];
        var fila = Object.assign({}, prev);
        var ignorar = (extra && extra.ignorar) || [];
        Object.keys(datos).forEach(function (c) {
          var v = datos[c];
          if (extra && extra.soloCrear) return;               // nombres ya existentes no se renombran desde el Excel
          if (ignorar.indexOf(c) >= 0) return;
          if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return; // el Excel no borra datos completados
          if (!igualV(prev[c], v)) { cambios.push({ campo: c, antes: prev[c], despues: v }); fila[c] = v; }
        });
        if (!fila.clave_import) fila.clave_import = clave;
        item = { estado: cambios.length ? 'cambio' : 'igual', fila: fila, antes: prev, cambios: cambios };
      }
      if (extra) Object.keys(extra).forEach(function (k) { if (k !== 'soloCrear' && k !== 'ignorar') item[k] = extra[k]; });
      porClave[k] = item;
      plan[t].push(item);
      return item;
    }
    function ruta(m) { return m && rutas[m] ? rutas[m] : null; }
    function rutasUnicas(lista) { var u = []; lista.forEach(function (m) { var r = ruta(m); if (r && u.indexOf(r) < 0) u.push(r); }); return u; }

    // Agrupar imágenes y descripciones por referencia (cliente + código)
    var refs = {};
    ext.filas.forEach(function (r) {
      var k = norm(r.cliente) + '|' + claveCodigo(r.codigo);
      var g = refs[k] = refs[k] || { imagenes: [], descripciones: [], filas: [] };
      rutasUnicas(r.imagenesRef).forEach(function (x) { if (g.imagenes.indexOf(x) < 0) g.imagenes.push(x); });
      if (r.referencia && g.descripciones.indexOf(r.referencia) < 0) g.descripciones.push(r.referencia);
      g.filas.push(r.fila);
    });

    // Telas escritas de varias formas ("67% Polyester/ 33% cotton", "67% polyester-33%cotton") → una sola
    var variantesTela = {};
    ext.filas.forEach(function (r) {
      r.telas.forEach(function (t) { if (!t) return; var v = variantesTela[claveTela(t)] = variantesTela[claveTela(t)] || {}; v[t] = (v[t] || 0) + 1; });
    });
    plan.unificadas = [];
    Object.keys(variantesTela).forEach(function (k) {
      var nombres = Object.keys(variantesTela[k]);
      if (nombres.length > 1) plan.unificadas.push('Tela escrita de ' + nombres.length + ' formas (' + nombres.map(function (n) { return '"' + n + '"'; }).join(', ') + '): se unificó en una sola.');
    });
    function nombreTela(t) {
      var v = variantesTela[claveTela(t)];
      return Object.keys(v).sort(function (a, b) { return v[b] - v[a] || b.length - a.length; })[0];
    }

    var vistos = {};
    ext.filas.forEach(function (r) {
      var cli = poner('cat_clientes', 'cli:' + norm(r.cliente), { nombre: r.cliente },
        function (x) { return norm(x.nombre) === norm(r.cliente); }, { soloCrear: true });
      var prov = r.proveedor ? poner('cat_proveedores', 'prov:' + norm(r.proveedor), { nombre: r.proveedor },
        function (x) { return norm(x.nombre) === norm(r.proveedor); }, { soloCrear: true }) : null;
      var kRef = norm(r.cliente) + '|' + claveCodigo(r.codigo);
      var g = refs[kRef];
      var avisosRef = [];
      if (g.imagenes.length > 1) avisosRef.push('Hay ' + g.imagenes.length + ' imágenes distintas para esta referencia en el Excel (filas ' + g.filas.join(', ') + '): la primera queda como principal.');
      if (g.descripciones.length > 1) avisosRef.push('Descripciones distintas en el Excel: ' + g.descripciones.join(' | ') + '. Se usa la primera.');
      var acc = poner('cat_accesorios', 'acc:' + kRef, {
        cliente_id: cli.fila.id, codigo: r.codigo, descripcion: g.descripciones[0] || null,
        imagen: g.imagenes[0] || null, imagenes_extra: g.imagenes.slice(1)
      }, function (x) { return x.cliente_id === cli.fila.id && claveCodigo(x.codigo) === claveCodigo(r.codigo); }, { avisos: avisosRef });

      var rub = null;
      var imgsRub = rutasUnicas(r.imagenesRub);
      if (imgsRub.length || r.rubber_texto) {
        var firma = imgsRub[0] || ('txt:' + norm(r.rubber_texto));
        rub = poner('cat_rubbers', 'rub:' + kRef + '|' + firma, {
          nombre: 'Rubber ' + r.codigo + (r.rubber_texto ? ' — ' + r.rubber_texto : ''),
          descripcion: r.rubber_texto, largo_cm: r.largo_cm, ancho_cm: r.ancho_cm,
          imagen: imgsRub[0] || null, imagenes_extra: imgsRub.slice(1), cliente_id: cli.fila.id
        }, null, { ignorar: ['nombre', 'cliente_id'] });
      }

      r.telas.forEach(function (telaNombre) {
        var tela = telaNombre ? poner('cat_telas', 'tela:' + claveTela(telaNombre), { nombre: nombreTela(telaNombre) },
          function (x) { return claveTela(x.nombre) === claveTela(telaNombre); }, { soloCrear: true }) : null;
        var clave = 'cfg:' + kRef + '|' + (telaNombre ? claveTela(telaNombre) : '-') + '|' + (rub ? rub.fila.clave_import : '-');
        var origen = 'Excel ' + r.hoja.trim() + ' fila ' + r.fila;
        if (vistos[clave]) {
          plan.duplicados.push({ origen: origen, igualA: vistos[clave], texto: origen + ' repite la combinación de ' + vistos[clave] + ' (misma referencia, tela y rubber); no se importa dos veces.' });
          return;
        }
        vistos[clave] = origen;
        var datos = {
          accesorio_id: acc.fila.id, tela_id: tela ? tela.fila.id : null, rubber_id: rub ? rub.fila.id : null,
          proveedor_id: prov ? prov.fila.id : null,
          temperatura_texto: r.temperatura_texto, temperatura_min: r.temperatura_min, temperatura_max: r.temperatura_max, temperatura_unidad: r.temperatura_unidad,
          presion_texto: r.presion_texto, presion_min_psi: r.presion_min_psi, presion_max_psi: r.presion_max_psi,
          tiempo_texto: r.tiempo_texto, desprendimiento: r.desprendimiento, desprendimiento_texto: r.desprendimiento_texto,
          observaciones: r.observaciones, pruebas_internas: r.pruebas_internas, fecha_texto: r.fecha_texto, fecha: r.fecha, origen: origen
        };
        var it = poner('cat_configuraciones', clave, datos, function (x) {
          return x.activo && x.accesorio_id === acc.fila.id && (x.tela_id || null) === (tela ? tela.fila.id : null) && (x.rubber_id || null) === (rub ? rub.fila.id : null);
        }, { origenFila: r, telaNombre: telaNombre });
        if (it.estado === 'nuevo') { it.fila.estado = 'pendiente'; it.fila.tipo_presion = 'pendiente'; }
        // "origen" solo informa; no cuenta como cambio de parámetros
        it.cambios = it.cambios.filter(function (c) { return c.campo !== 'origen'; });
        if (it.estado === 'cambio' && !it.cambios.length) it.estado = 'igual';
        if (it.estado === 'cambio' && it.antes && it.antes.estado === 'aprobado') {
          it.reaprobar = true;
          it.fila.estado = 'pendiente';
        }
      });
    });
    return plan;
  }

  root.ImportarExcel = {
    leerLibro: leerLibro, extraer: extraer, planificar: planificar,
    // expuestas para pruebas
    _dividirTelas: dividirTelas, _tipoDesprendimiento: tipoDesprendimiento, _fechaTexto: fechaTexto, _claveTela: claveTela, CAMPOS_CONFIG: CAMPOS_CONFIG
  };
})(self);
