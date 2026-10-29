/*
 * calculos.js — Motor de cálculo de fuerza y presión para máquinas transfer.
 * No depende del navegador: se puede probar con Node (ver tests/pruebas-calculos.js).
 * Todos los cálculos internos se hacen con precisión completa; solo se redondea al mostrar.
 */
(function (root) {
  'use strict';

  // Constantes de conversión (las mismas indicadas en la especificación)
  var K = {
    CM2_POR_IN2: 6.4516,     // 1 in² = 6.4516 cm²
    LB_POR_KG: 2.20462262185, // 1 kgf = 2.20462262185 lbf
    N_POR_LBF: 4.44822161526, // 1 lbf = 4.44822161526 N
    PSI_POR_KGFCM2: 14.2233, // 1 kgf/cm² = 14.2233 psi
    PSI_POR_BAR: 14.5038     // 1 bar = 14.5038 psi
  };

  var UNIDADES_FUERZA = ['lbf', 'kgf', 'N'];
  var UNIDADES_PRESION = ['psi', 'bar', 'kgfcm2'];

  /** Convierte texto a número. Acepta coma o punto decimal. Devuelve NaN si no es válido. */
  function parseNumero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
    if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function esPositivo(n) { return typeof n === 'number' && isFinite(n) && n > 0; }

  /** Área de un rectángulo dado en cm. */
  function areaRect(largoCm, anchoCm) {
    var cm2 = largoCm * anchoCm;
    return { cm2: cm2, in2: cm2 / K.CM2_POR_IN2 };
  }

  /** Convierte una fuerza en cualquier unidad a lbf. */
  function fuerzaALbf(valor, unidad) {
    switch (unidad) {
      case 'lbf': return valor;
      case 'kgf': return valor * K.LB_POR_KG;
      case 'N': return valor / K.N_POR_LBF;
      default: throw new Error('Unidad de fuerza no válida: ' + unidad);
    }
  }

  /** A partir de lbf devuelve la fuerza en las tres unidades. */
  function fuerzaDesdeLbf(lbf) {
    return { lbf: lbf, kgf: lbf / K.LB_POR_KG, N: lbf * K.N_POR_LBF };
  }

  /** Convierte una presión (psi, bar, kgf/cm²) a psi. */
  function presionAPsi(valor, unidad) {
    switch (unidad) {
      case 'psi': return valor;
      case 'bar': return valor * K.PSI_POR_BAR;
      case 'kgfcm2': return valor * K.PSI_POR_KGFCM2;
      default: throw new Error('Unidad de presión no válida: ' + unidad);
    }
  }

  /** A partir de psi devuelve la presión en psi, kgf/cm² y bar. */
  function presionDesdePsi(psi) {
    return { psi: psi, kgfcm2: psi / K.PSI_POR_KGFCM2, bar: psi / K.PSI_POR_BAR };
  }

  /** Función 1: fuerza necesaria para lograr una presión promedio deseada sobre el rubber. */
  function fuerzaNecesaria(largoCm, anchoCm, psiDeseada) {
    var area = areaRect(largoCm, anchoCm);
    return { area: area, presion: presionDesdePsi(psiDeseada), fuerza: fuerzaDesdeLbf(psiDeseada * area.in2) };
  }

  /**
   * Presión promedio en psi a partir de la fuerza en lbf y las medidas en cm.
   * Única fórmula de presión de la app:  psi = lbf × 6.4516 ÷ (largo × ancho)
   * (equivale a lbf ÷ área en in², porque área in² = largo × ancho ÷ 6.4516).
   */
  function presionPsi(lbf, largoCm, anchoCm) {
    return lbf * K.CM2_POR_IN2 / (largoCm * anchoCm);
  }

  /** Función 2: presión promedio estimada a partir de la lectura del dinamómetro (lbf, kgf o N). */
  function presionMedida(largoCm, anchoCm, lectura, unidad) {
    var area = areaRect(largoCm, anchoCm);
    var lbf = fuerzaALbf(lectura, unidad);
    return { area: area, fuerza: fuerzaDesdeLbf(lbf), presion: presionDesdePsi(presionPsi(lbf, largoCm, anchoCm)) };
  }


  // ---------------------------------------------------------------
  // Catálogo: rangos de presión y lectura objetivo del dinamómetro
  // ---------------------------------------------------------------
  var NUM = '(\\d+(?:[.,]\\d+)?)';
  var RE_RANGO = new RegExp('^' + NUM + '(?:\\s*(?:-+|–|—|\\ba\\b|\\bal\\b|\\bto\\b)\\s*' + NUM + ')?\\s*' +
    '(psi|lbs?|lbf|°\\s*[cf]|º\\s*[cf]|grados|segundos?|seg|s)?\\.?$', 'i');

  /**
   * Interpreta un valor o rango escrito a mano: 30, "20-30", "15- 20", "25-30 psi", "160--165", "3 a 4".
   * Devuelve { min, max, unidad, texto } o null si no es un número o rango simple.
   * Un valor único devuelve min = max. No interpreta textos con varias pasadas.
   */
  function parseRango(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? { min: v, max: v, unidad: null, texto: String(v) } : null;
    var texto = String(v);
    var s = texto.trim().replace(/\s+/g, ' ');
    if (!s) return null;
    var m = s.match(RE_RANGO);
    if (!m) return null;
    var a = Number(m[1].replace(',', '.')), b = m[2] !== undefined ? Number(m[2].replace(',', '.')) : a;
    if (!(a > 0) || !(b > 0)) return null;
    var u = m[3] ? m[3].toLowerCase().replace(/[\sº]/g, '').replace('°', '°') : null;
    if (u === '°c' || u === 'ºc') u = '°C'; else if (u === '°f' || u === 'ºf') u = '°F';
    else if (u === 'lbs' || u === 'lb' || u === 'lbf') u = 'lbf';
    else if (u && /^s|seg/.test(u)) u = 's';
    return { min: Math.min(a, b), max: Math.max(a, b), invertido: a > b, unidad: u, texto: texto };
  }

  /** Regla del catálogo: se usa el valor MÁXIMO del rango aprobado; un valor único se usa tal cual. */
  function presionObjetivo(minPsi, maxPsi) {
    if (esPositivo(maxPsi)) return maxPsi;
    if (esPositivo(minPsi)) return minPsi;
    return null;
  }

  var TIPOS_PRESION = {
    contacto_rubber: 'Presión de contacto sobre el rubber',
    aire_manometro: 'Presión del aire del manómetro',
    pendiente: 'Pendiente de confirmar'
  };

  /**
   * Lectura objetivo del dinamómetro para una configuración del catálogo.
   * conf: { presion_min_psi, presion_max_psi, tipo_presion }   rubber: { largo_cm, ancho_cm }
   * Solo calcula si la presión del proveedor es presión de CONTACTO sobre el rubber y hay dimensiones.
   * Devuelve { ok, motivos: [{codigo, texto}], presionObjetivo, area, fuerza }.
   */
  function fuerzaObjetivo(conf, rubber) {
    conf = conf || {}; rubber = rubber || {};
    var motivos = [];
    var obj = presionObjetivo(Number(conf.presion_min_psi), Number(conf.presion_max_psi));
    var tipo = conf.tipo_presion || 'pendiente';
    var l = Number(rubber.largo_cm), a = Number(rubber.ancho_cm);
    if (obj === null) motivos.push({ codigo: 'sin-presion', texto: 'Falta el rango de presión en el catálogo.' });
    if (tipo === 'pendiente') motivos.push({ codigo: 'tipo-pendiente', texto: 'Pendiente de confirmar el tipo de presión.' });
    else if (tipo === 'aire_manometro') motivos.push({ codigo: 'aire', texto: 'La presión del proveedor es del aire del manómetro: no se convierte directamente en fuerza sobre el rubber.' });
    else if (tipo !== 'contacto_rubber') motivos.push({ codigo: 'tipo-desconocido', texto: 'Tipo de presión no reconocido.' });
    if (!esPositivo(l) || !esPositivo(a)) motivos.push({ codigo: 'sin-dimensiones', texto: 'Faltan el largo y el ancho del rubber en el catálogo.' });
    var res = { ok: motivos.length === 0, motivos: motivos, presionObjetivo: obj, tipo: tipo, area: null, fuerza: null };
    if (esPositivo(l) && esPositivo(a)) res.area = areaRect(l, a);
    if (res.ok) res.fuerza = fuerzaDesdeLbf(obj * res.area.in2);
    return res;
  }

  /**
   * Función 4: tabla de equivalencias.
   * modo 'lbf': filas por fuerza; modo 'psi': filas por presión deseada.
   */
  function tablaEquivalencias(modo, inicio, fin, paso, areaIn2, maxFilas) {
    maxFilas = maxFilas || 500;
    if (!(paso > 0) || !(fin >= inicio) || !(inicio >= 0) || !(areaIn2 > 0)) {
      throw new Error('Parámetros de tabla no válidos');
    }
    var nFilas = Math.floor((fin - inicio) / paso + 1e-9) + 1;
    if (nFilas > maxFilas) throw new Error('La tabla tendría ' + nFilas + ' filas (máximo ' + maxFilas + '). Aumenta el incremento.');
    var filas = [];
    for (var i = 0; i < nFilas; i++) {
      var v = inicio + i * paso;
      var lbf = modo === 'psi' ? v * areaIn2 : v;
      var f = fuerzaDesdeLbf(lbf);
      filas.push({ lbf: f.lbf, kgf: f.kgf, N: f.N, psi: lbf / areaIn2 });
    }
    return filas;
  }

  /** Regresión lineal por mínimos cuadrados (y = m·x + b). */
  function regresionLineal(puntos) {
    var n = puntos.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    puntos.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; });
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null; // todas las x iguales
    var m = (n * sxy - sx * sy) / den;
    var b = (sy - m * sx) / n;
    var ssTot = syy - (sy * sy) / n;
    var ssRes = 0;
    puntos.forEach(function (p) { var e = p.y - (m * p.x + b); ssRes += e * e; });
    var r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 1;
    return { m: m, b: b, r2: r2, n: n };
  }

  /**
   * Sugerencia de ajuste del manómetro a partir de mediciones de UNA máquina con el MISMO rubber y montaje.
   * puntos: [{ manPsi, fuerzaLbf }]. No existe conversión directa aire→logo: solo se interpola con datos reales.
   */
  function sugerirManometro(puntos, fuerzaObjetivoLbf) {
    var MSG = 'No es posible determinar el ajuste del manómetro sin mediciones de esta máquina y este montaje.';
    if (!puntos || puntos.length < 2) return { ok: false, mensaje: MSG, detalle: 'Se necesitan al menos 2 pruebas con distintas presiones de manómetro.' };
    var distintos = {};
    puntos.forEach(function (p) { distintos[p.manPsi.toFixed(6)] = true; });
    if (Object.keys(distintos).length < 2) return { ok: false, mensaje: MSG, detalle: 'Todas las pruebas tienen la misma presión de manómetro. Registra pruebas con otros ajustes.' };
    var reg = regresionLineal(puntos.map(function (p) { return { x: p.manPsi, y: p.fuerzaLbf }; }));
    if (!reg || !(reg.m > 0)) return { ok: false, mensaje: MSG, detalle: 'Los datos no muestran que la fuerza aumente con la presión del manómetro. Revisa las mediciones.' };
    var manPsi = (fuerzaObjetivoLbf - reg.b) / reg.m;
    var xs = puntos.map(function (p) { return p.manPsi; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    if (!(manPsi > 0)) return { ok: false, mensaje: MSG, detalle: 'La fuerza objetivo queda por debajo de lo que el modelo de esta máquina puede estimar. Mide con presiones más bajas.' };
    return {
      ok: true, manPsi: manPsi, man: presionDesdePsi(manPsi),
      m: reg.m, b: reg.b, r2: reg.r2, n: reg.n, xmin: xmin, xmax: xmax,
      extrapola: manPsi < xmin - 1e-9 || manPsi > xmax + 1e-9
    };
  }

  /** Clave de grupo de calibración: misma máquina + mismo rubber + mismo montaje. */
  function claveGrupo(reg) {
    var norm = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
    return norm(reg.maquina) + '|' + Number(reg.largo).toFixed(2) + 'x' + Number(reg.ancho).toFixed(2) + '|' + norm(reg.montaje);
  }

  /** Redondeo numérico (solo para mostrar o exportar). */
  function redondear(v, d) {
    d = d === undefined ? 2 : d;
    var f = Math.pow(10, d);
    return Math.round((v + Number.EPSILON) * f) / f;
  }

  /** Formato para pantalla: punto decimal, coma de miles, d decimales. */
  function formatear(v, d) {
    d = d === undefined ? 2 : d;
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return redondear(v, d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  var Calc = {
    K: K, UNIDADES_FUERZA: UNIDADES_FUERZA, UNIDADES_PRESION: UNIDADES_PRESION,
    parseNumero: parseNumero, esPositivo: esPositivo, areaRect: areaRect,
    fuerzaALbf: fuerzaALbf, fuerzaDesdeLbf: fuerzaDesdeLbf,
    presionAPsi: presionAPsi, presionDesdePsi: presionDesdePsi,
    fuerzaNecesaria: fuerzaNecesaria, presionMedida: presionMedida, presionPsi: presionPsi,
    tablaEquivalencias: tablaEquivalencias, regresionLineal: regresionLineal,
    sugerirManometro: sugerirManometro, claveGrupo: claveGrupo,
    redondear: redondear, formatear: formatear,
    parseRango: parseRango, presionObjetivo: presionObjetivo, fuerzaObjetivo: fuerzaObjetivo, TIPOS_PRESION: TIPOS_PRESION
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof self !== 'undefined' ? self : this);
