/*
 * Pruebas de los cálculos. Ejecutar con:  node tests/pruebas-calculos.js
 * (requiere Node.js; no es necesario para usar la aplicación)
 */
'use strict';
const C = require('../js/calculos.js');

let fallos = 0, total = 0;
function cerca(nombre, obtenido, esperado, tol) {
  total++;
  tol = tol === undefined ? 0.01 : tol;
  const ok = Math.abs(obtenido - esperado) <= tol;
  if (!ok) fallos++;
  console.log((ok ? '  OK   ' : '  FALLA') + '  ' + nombre + ': ' + obtenido.toFixed(4) + ' (esperado ' + esperado + ' ± ' + tol + ')');
}
function igual(nombre, obtenido, esperado) {
  total++;
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log((ok ? '  OK   ' : '  FALLA') + '  ' + nombre + ': ' + JSON.stringify(obtenido));
}

console.log('\n1) Fuerza necesaria — rubber 4.5 × 1.1 cm, 40 psi');
let r = C.fuerzaNecesaria(4.5, 1.1, 40);
cerca('Área cm²', r.area.cm2, 4.95, 1e-9);
cerca('Área in²', r.area.in2, 0.7673, 0.0001);
cerca('Fuerza lbf', r.fuerza.lbf, 30.69, 0.01);
cerca('Fuerza kgf', r.fuerza.kgf, 13.92, 0.01);
cerca('Fuerza N', r.fuerza.N, 136.5, 0.05);

console.log('\n2) Plancha 20 × 30 cm');
let p = C.areaRect(20, 30);
cerca('Área cm²', p.cm2, 600, 1e-9);
cerca('Área in²', p.in2, 93.00, 0.005);

console.log('\n3) Presión desde dinamómetro (ida y vuelta)');
r = C.presionMedida(4.5, 1.1, 30.69, 'lbf');
cerca('30.69 lbf → psi', r.presion.psi, 40.00, 0.01);
cerca('psi → kgf/cm²', r.presion.kgfcm2, 40 / 14.2233, 0.001);
cerca('psi → bar', r.presion.bar, 40 / 14.5038, 0.001);
r = C.presionMedida(4.5, 1.1, 13.92, 'kgf');
cerca('13.92 kgf → lbf', r.fuerza.lbf, 30.688, 0.01);
cerca('13.92 kgf → psi', r.presion.psi, 40.00, 0.02);
r = C.presionMedida(4.5, 1.1, 136.5, 'N');
cerca('136.5 N → lbf', r.fuerza.lbf, 30.686, 0.01);
cerca('136.5 N → psi', r.presion.psi, 39.99, 0.02);
r = C.presionMedida(4.5, 1.1, 50, 'lbf');
cerca('50 lbf → psi', r.presion.psi, 65.17, 0.01);
cerca('50 lbf → kgf/cm²', r.presion.kgfcm2, 4.58, 0.01);
cerca('50 lbf → bar', r.presion.bar, 4.49, 0.01);

console.log('\n4) Conversiones de manómetro');
cerca('6 bar → psi', C.presionAPsi(6, 'bar'), 87.02, 0.01);
cerca('5 kgf/cm² → psi', C.presionAPsi(5, 'kgfcm2'), 71.12, 0.01);

console.log('\n5) Tabla de equivalencias');
let t = C.tablaEquivalencias('lbf', 10, 30, 10, C.areaRect(4.5, 1.1).in2);
igual('Filas (10,20,30)', t.length, 3);
cerca('Fila 3 psi', t[2].psi, 39.10, 0.01);
t = C.tablaEquivalencias('psi', 10, 80, 10, C.areaRect(4.5, 1.1).in2);
igual('Filas (10..80)', t.length, 8);
cerca('Fila 40 psi → lbf', t[3].lbf, 30.69, 0.01);
t = C.tablaEquivalencias('lbf', 0.1, 0.3, 0.1, 1);
igual('Paso decimal 0.1 sin perder última fila', t.length, 3);

console.log('\n6) Sugerencia de manómetro');
let s = C.sugerirManometro([], 30);
igual('Sin datos → no disponible', s.ok, false);
igual('Mensaje exacto', s.mensaje, 'No es posible determinar el ajuste del manómetro sin mediciones de esta máquina y este montaje.');
s = C.sugerirManometro([{ manPsi: 40, fuerzaLbf: 20 }, { manPsi: 40, fuerzaLbf: 21 }], 30);
igual('Misma presión repetida → no disponible', s.ok, false);
// Datos sintéticos: fuerza = 0.5·man + 2
s = C.sugerirManometro([{ manPsi: 40, fuerzaLbf: 22 }, { manPsi: 60, fuerzaLbf: 32 }, { manPsi: 80, fuerzaLbf: 42 }], 30.69);
igual('Con datos → disponible', s.ok, true);
cerca('Manómetro sugerido psi', s.manPsi, 57.38, 0.01);
cerca('R²', s.r2, 1, 1e-9);
igual('Dentro del rango', s.extrapola, false);
s = C.sugerirManometro([{ manPsi: 40, fuerzaLbf: 22 }, { manPsi: 60, fuerzaLbf: 32 }], 60);
igual('Fuera del rango → marcado', s.extrapola, true);

console.log('\n7b) Fórmula de presión psi = lbf × 6.4516 ÷ (largo × ancho) — rubber 4.5 × 1.1 cm, 30 lbf');
const formula = (lbf, l, a) => lbf * 6.4516 / (l * a);
cerca('Fórmula directa', formula(30, 4.5, 1.1), 39.10, 0.005);
cerca('presionPsi()', C.presionPsi(30, 4.5, 1.1), 39.10, 0.005);
cerca('30 lbf', C.presionMedida(4.5, 1.1, 30, 'lbf').presion.psi, 39.10, 0.005);
cerca('30 lbf en kgf', C.presionMedida(4.5, 1.1, 30 / 2.20462, 'kgf').presion.psi, 39.10, 0.005);
cerca('30 lbf en N', C.presionMedida(4.5, 1.1, 30 * 4.44822, 'N').presion.psi, 39.10, 0.005);
cerca('Igual a lbf ÷ área in²', C.presionPsi(30, 4.5, 1.1), 30 / C.areaRect(4.5, 1.1).in2, 1e-9);
igual('Muestra 39.10', C.formatear(C.presionMedida(4.5, 1.1, 30, 'lbf').presion.psi), '39.10');


console.log('\n8) Catálogo — lectura objetivo del dinamómetro (presión de contacto sobre el rubber)');
const contacto = (min, max) => ({ presion_min_psi: min, presion_max_psi: max, tipo_presion: 'contacto_rubber' });
let o = C.fuerzaObjetivo(contacto(40, 40), { largo_cm: 4.5, ancho_cm: 1.1 });
igual('4.5 × 1.1 cm, 40 psi → calcula', o.ok, true);
cerca('4.5 × 1.1 cm, 40 psi → lbf', o.fuerza.lbf, 30.69, 0.005);
o = C.fuerzaObjetivo(contacto(20, 20), { largo_cm: 4, ancho_cm: 2 });
cerca('4 × 2 cm, 20 psi → lbf', o.fuerza.lbf, 24.80, 0.005);
cerca('4 × 2 cm, 20 psi → kgf', o.fuerza.kgf, 11.25, 0.005);
cerca('4 × 2 cm, 20 psi → N', o.fuerza.N, 110.32, 0.005);
igual('Muestra 24.80 / 11.25 / 110.32', [C.formatear(o.fuerza.lbf), C.formatear(o.fuerza.kgf), C.formatear(o.fuerza.N)].join(' / '), '24.80 / 11.25 / 110.32');
cerca('Cálculo inverso existente 30 lbf → psi', C.presionMedida(4.5, 1.1, 30, 'lbf').presion.psi, 39.10, 0.005);
cerca('Ida y vuelta: objetivo 40 psi → lbf → psi', C.presionPsi(C.fuerzaObjetivo(contacto(40, 40), { largo_cm: 4.5, ancho_cm: 1.1 }).fuerza.lbf, 4.5, 1.1), 40, 1e-9);

console.log('\n9) Regla del máximo del rango');
igual('20-30 → 30', C.presionObjetivo(20, 30), 30);
igual('50-60 → 60', C.presionObjetivo(50, 60), 60);
igual('Valor único 30 → 30', C.presionObjetivo(30, 30), 30);
igual('Solo mínimo 30 → 30', C.presionObjetivo(30, null), 30);
igual('Sin presión → null', C.presionObjetivo(null, null), null);
const r1 = C.parseRango('20-30'), r2 = C.parseRango('15- 20'), r3 = C.parseRango('25-30 psi'), r4 = C.parseRango(30);
igual('"20-30" → 20..30', r1.min + '..' + r1.max, '20..30');
igual('"15- 20" → 15..20', r2.min + '..' + r2.max, '15..20');
igual('"25-30 psi" → 25..30 psi', r3.min + '..' + r3.max + ' ' + r3.unidad, '25..30 psi');
igual('30 → 30..30', r4.min + '..' + r4.max, '30..30');
igual('"160--165" → 160..165', C.parseRango('160--165').max, 165);
igual('Conserva texto original', r3.texto, '25-30 psi');
igual('Texto con varias pasadas no se convierte', C.parseRango('7 Segundos lado frontal. 7 segundos lado inferior.'), null);
o = C.fuerzaObjetivo(contacto(20, 30), { largo_cm: 4, ancho_cm: 2 });
igual('Rango 20-30 usa 30 psi', o.presionObjetivo, 30);
cerca('Rango 20-30 en 4 × 2 → lbf', o.fuerza.lbf, 37.20, 0.005);

console.log('\n10) Bloqueos del cálculo');
const motivos = (x) => x.motivos.map(m => m.codigo).join(',');
o = C.fuerzaObjetivo(contacto(20, 30), { largo_cm: null, ancho_cm: 2 });
igual('Sin largo → no calcula', o.ok, false);
igual('Sin largo → motivo', motivos(o), 'sin-dimensiones');
igual('Sin largo → sin fuerza', o.fuerza, null);
o = C.fuerzaObjetivo({ presion_min_psi: 20, presion_max_psi: 30, tipo_presion: 'pendiente' }, { largo_cm: 4, ancho_cm: 2 });
igual('Tipo pendiente → no calcula', o.ok, false);
igual('Tipo pendiente → mensaje', o.motivos[0].texto, 'Pendiente de confirmar el tipo de presión.');
igual('Tipo pendiente → sin fuerza', o.fuerza, null);
o = C.fuerzaObjetivo({ presion_min_psi: 20, presion_max_psi: 30 }, { largo_cm: 4, ancho_cm: 2 });
igual('Tipo vacío = pendiente', motivos(o), 'tipo-pendiente');
o = C.fuerzaObjetivo({ presion_min_psi: 60, presion_max_psi: 60, tipo_presion: 'aire_manometro' }, { largo_cm: 4, ancho_cm: 2 });
igual('Aire del manómetro → no convierte', motivos(o), 'aire');
igual('Aire del manómetro → sin fuerza', o.fuerza, null);
o = C.fuerzaObjetivo({ tipo_presion: 'contacto_rubber' }, { largo_cm: 4, ancho_cm: 2 });
igual('Sin presión → no calcula', motivos(o), 'sin-presion');
o = C.fuerzaObjetivo({ tipo_presion: 'pendiente' }, {});
igual('Varios faltantes se informan juntos', motivos(o), 'sin-presion,tipo-pendiente,sin-dimensiones');

console.log('\n7) Validación de números');
igual('"4,5" → 4.5', C.parseNumero('4,5'), 4.5);
igual('"abc" → NaN', Number.isNaN(C.parseNumero('abc')), true);
igual('"" → NaN', Number.isNaN(C.parseNumero('')), true);
igual('"1.2.3" → NaN', Number.isNaN(C.parseNumero('1.2.3')), true);
igual('Formato 2 decimales', C.formatear(30.68996), '30.69');

console.log('\nResultado: ' + (total - fallos) + '/' + total + ' pruebas correctas.');
process.exit(fallos ? 1 : 0);
