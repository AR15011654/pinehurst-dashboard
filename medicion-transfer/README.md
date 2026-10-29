# Medición Transfer v3 — Máquinas Heat Transfer

Aplicación web para calcular, validar y registrar la **fuerza** y la **presión promedio** en el pegado de logos con máquinas Heat Transfer. Funciona en celular (Android y iPhone) y computadora, se instala en la pantalla de inicio y trabaja **sin conexión**. Los registros se guardan en una **base de datos en la nube (Supabase)**, compartida por todos los teléfonos.

> La app distingue siempre tres magnitudes distintas:
> 1. **Presión del aire** en el manómetro de la máquina (psi, bar o kgf/cm²).
> 2. **Fuerza** medida por el dinamómetro (lbf, kgf o N).
> 3. **Presión promedio calculada** sobre el área del rubber (psi, kgf/cm², bar).
>
> No existe una conversión directa entre 1 y 3: depende de cada máquina y montaje, y solo se obtiene midiendo.

---

## 0. Versión 3: catálogo de parámetros de trims

### Qué cambió
| Cambio | Detalle |
|---|---|
| Cálculo de presión guiado | El técnico ya no escribe largo, ancho ni presión. Elige: **Línea (L1–L50) → Máquina (serie o QR) → Cliente → Referencia** (código, descripción e imagen) **→ Tipo de tela** (se elige sola si hay una) **→ Rubber o molde** (imagen, descripción y medidas; se elige solo si hay uno aprobado). Al cambiar cliente, referencia o tela se limpian los pasos siguientes. |
| Parámetros | Tabla compacta: cliente, código y referencia, tela, proveedor, imágenes del accesorio y del rubber, tipo y medidas del rubber, temperatura y unidad, rango de presión **original**, presión objetivo, tipo de presión, tiempo o secuencia **tal cual**, desprendimiento del film y observaciones. Los parámetros de pruebas internas aparecen aparte. |
| Presión y temperatura | Se muestran **mínimo y máximo** tomados del Excel (20–30 psi; 155–160 °C) y el texto original. Las temperaturas son **°C**. |
| Lectura del dinamómetro (v3.1) | **Mínima** (con la presión mínima) y **máxima** (con la presión máxima), en lbf, kgf y N. Un valor único da una sola lectura. Solo si el catálogo dice **presión de contacto sobre el rubber** y el rubber tiene largo y ancho; si es presión del **aire del manómetro** o está **pendiente de confirmar**, no se muestra ninguna fuerza. Validación indica si la medición queda por debajo, dentro o por encima del rango. |
| Traslado | "Pasar a validación" y "Pasar a registro de pruebas" llevan la línea, la máquina, el rubber y el objetivo. Validación compara lo medido con el objetivo. |
| Catálogo (administrador) | Clientes, proveedores, telas, referencias con imágenes, rubbers con imágenes y medidas, y parámetros por **referencia + tela + rubber**. Estados *Pendiente de validar* / *Aprobado*. Desactivar en lugar de borrar. Buscador, formularios y vista previa de imágenes. |
| Importar Excel | Lee "Parametros de Trims" en el navegador, muestra **vista previa** con avisos y se confirma. Reimportar no duplica y muestra los cambios antes de sobrescribir. |
| Trazabilidad | Cada cambio del catálogo guarda usuario, fecha, valores anteriores y nuevos, y sube la versión. Cada registro guarda la versión y una **copia** de los parámetros usados: editar el catálogo después no altera los registros. |
| Permisos en el servidor | La cuenta general solo **lee configuraciones aprobadas** y registra mediciones. Solo el administrador escribe en el catálogo y sube imágenes (RLS de Supabase; imágenes en un bucket **privado**). Nadie puede borrar filas del catálogo. |

### Instalar la versión 3 (una sola vez)
1. Supabase → **SQL Editor** → pega `supabase/migracion-v3-catalogo.sql` → **Run**. Solo agrega tablas y columnas; no cambia los registros existentes.
2. (Opcional) Pega `supabase/pruebas-permisos.sql` → **Run**: deben salir 14 filas sin "MAL" ni "ERROR". La prueba deshace todo al terminar.
3. Sube los archivos de la app a GitHub (sección 5). `sw.js` ya tiene `VERSION = 'v3.0.0'`.

### Importar y completar el catálogo (administrador)
1. Inicia sesión con tu usuario de administrador (Ajustes → Cerrar sesión → *Entrar con otro usuario*).
2. Pantalla principal → **Catálogo de parámetros** → pestaña **Importar Excel** → elige el archivo.
3. Revisa la vista previa: filas leídas, hojas excluidas, telas unificadas, imágenes recuperadas o sin asociar, fechas dudosas y datos faltantes. Pulsa **Importar**.
4. Todo entra como **Pendiente de validar** y con tipo de presión **Pendiente de confirmar**. Para cada combinación:
   - Pestaña **Rubbers**: escribe **largo y ancho** (cm) del área efectiva y, si quieres, el tipo y un mejor nombre.
   - Pestaña **Parámetros**: indica **qué representa la presión** (contacto sobre el rubber o aire del manómetro), la **unidad de temperatura**, y cambia el estado a **Aprobado**. El formulario muestra la lectura objetivo que verá el técnico o por qué no la habrá.
5. Si importas una versión nueva del Excel, solo se crean las combinaciones nuevas; las que cambiaron aparecen con "Actual / Excel" y una casilla para aplicar. Los datos que completaste en la app (medidas, tipo de presión, estado) no se borran.

### Lo que el Excel no trae (se completa en la app)
- Medidas del rubber: las columnas "Largo Ruber" y "Ancho Ruber" están vacías en todas las hojas.
- Unidad de temperatura: el Excel no la indica; se confirmó que es °C (al importar se elige la unidad, °C por defecto).
- Qué representa la presión del proveedor.
- Tela en Adidas y Oakley (sus hojas no tienen esa columna).
- Rubber en Adidas 80031326 y Long Walk LWGPL001-SIL.
- Fechas de Milwaukee escritas como "10/23/205" y "10/24/205": se conserva el texto y la fecha queda vacía.

## 1. Qué cambió en la versión 2

| Cambio | Detalle |
|---|---|
| Pantalla principal | Los módulos aparecen como botones grandes. Cada uno muestra mediciones de hoy, registros guardados y registros pendientes de subir. Arriba: totales del día, registros guardados y máquinas medidas, y el estado de la base de datos. |
| Nombres | *Fuerza necesaria* → **Cálculo de presión** · *Presión medida* → **Validación de presión** · *Calibración* → **Registro de pruebas**. |
| Tabla de equivalencias | Eliminada. |
| Guardar registro | Los tres módulos tienen **Guardar registro**. Cada módulo guarda en su propia tabla de la base de datos (`registro_pruebas` es un espacio propio). |
| Máquina obligatoria | Cada registro guarda la máquina (serie, QR, Asset ID, línea, estación). Se elige **escaneando el QR** con la cámara o **escribiendo la serie**. |
| Inventario | Incluye las **98 máquinas** con TIPO DE MAQUINA = HEAT TRANSFER de la pestaña MAQUINAS de `INVENTARIO MAQUINAS.xlsx`. |
| Historial | Pestañas por módulo, filtro por máquina, exportación a Excel (una hoja por módulo), CSV y PDF. |
| Migración | Las pruebas guardadas con la versión 1 en el teléfono pasan solas a *Registro de pruebas*. |

## 2. Estructura de carpetas

```
medicion-transfer/
├── index.html                 ← interfaz
├── manifest.webmanifest       ← instalación en el celular
├── sw.js                      ← funcionamiento sin conexión (VERSION)
├── README.md
├── css/styles.css
├── js/
│   ├── config.js              ← ★ datos de conexión de Supabase (URL y clave anon)
│   ├── calculos.js            ← fórmulas
│   ├── maquinas.js            ← inventario Heat Transfer (generado)
│   ├── db.js                  ← base de datos local + sincronización con Supabase
│   ├── app.js                 ← pantallas
│   ├── importar-excel.js      ← lectura del Excel "Parametros de Trims" (v3)
│   ├── admin.js               ← catálogo de parámetros, solo administrador (v3)
│   ├── xlsx-mini.js           ← exportar Excel sin internet
│   ├── jsQR.js                ← lector de QR (Apache 2.0, ver jsQR-LICENSE.txt)
│   └── jsQR-LICENSE.txt
├── supabase/
│   ├── esquema.sql            ← ★ script que crea las tablas de la base de datos
│   ├── migracion-v3-catalogo.sql ← ★ catálogo, historial, permisos e imágenes (v3)
│   └── pruebas-permisos.sql   ← verificación de permisos (deshace todo al terminar)
├── herramientas/
│   └── generar-maquinas.py    ← actualiza js/maquinas.js desde el Excel de inventario
├── icons/                     ← íconos de la app
└── tests/pruebas-calculos.js  ← pruebas de las fórmulas (Node.js, opcional)
```

## 3. Base de datos en la nube (Supabase) — configuración única

Sin este paso la app funciona en **modo local** (cada teléfono guarda sus registros). Con Supabase, todos los teléfonos comparten los registros.

### 3.1 Crear el proyecto
1. Entra a <https://supabase.com> → **Start your project** y crea una cuenta (puede ser con GitHub).
2. **New project** → nombre `medicion-transfer`, contraseña de base de datos segura (guárdala; no va en la app), región más cercana (por ejemplo *East US*). Plan **Free**.
3. Espera 1–2 minutos a que el proyecto esté listo.

### 3.2 Crear las tablas
1. Menú izquierdo → **SQL Editor** → **New query**.
2. Abre `supabase/esquema.sql`, copia todo, pégalo y pulsa **Run**. Debe decir *Success*.
3. En **Table Editor** verás: `calculo_presion`, `validacion_presion` y `registro_pruebas`.

El script se puede ejecutar de nuevo sin borrar datos.

### 3.3 Usuarios: cuenta general de planta + administrador
| Cuenta | Quién la usa | Puede |
|---|---|---|
| `planta.transfer@pinehurstmfg.com` (general) | Todos los técnicos | Consultar y **agregar** registros |
| `irivera@pinehurstmfg.com` (administrador) | Solo el creador | Consultar, agregar, **editar y eliminar** |

1. **Authentication → Sign In / Providers**: **Allow new users to sign up** desactivado (ya está hecho), para que nadie pueda crearse una cuenta.
2. **Authentication → Users → Add user → Create new user**: crea las dos cuentas de la tabla con **Auto Confirm User** marcado. La contraseña de la cuenta general la eliges tú y solo la das a los técnicos; **no la escribas en ningún archivo de GitHub**.
3. En cada teléfono: botón **"Sin sesión"** → escribir la contraseña general → **Conectar**. Solo se pide una vez; el teléfono queda conectado.
4. Administrador: en el mismo diálogo, **Entrar con otro usuario (administrador)**.
5. Si la contraseña general se filtra: *Authentication → Users* → cuenta general → cambia la contraseña, y vuelve a conectar los teléfonos.
6. Para agregar otro administrador: añade su correo en `administradores` de `js/config.js` **y** en la función `public.es_admin()` de `supabase/esquema.sql` (vuelve a ejecutarlo).

Solo tú tienes acceso al panel de Supabase y permiso de escritura en GitHub. El repositorio es público (requisito de GitHub Pages gratis): cualquiera puede ver el código, pero no contiene contraseñas y los registros solo se ven con sesión.

### 3.4 Conectar la app
1. En Supabase: **Project Settings → API** (o **API Keys**). Copia:
   - **Project URL** (ej. `https://abcdxyz.supabase.co`)
   - **anon public** key, o la **publishable key** (`sb_publishable_…`).
   - ⚠️ **Nunca** uses la clave `service_role` ni una `secret key`.
2. Abre `js/config.js` y pega los dos valores:
   ```js
   self.TRANSFER_CONFIG = {
     supabaseUrl: 'https://abcdxyz.supabase.co',
     supabaseAnonKey: 'pega-aqui-la-clave-anon-o-publishable'
   };
   ```
3. Sube `js/config.js` a GitHub (ver sección 5). La clave anon/publishable está diseñada para ir en sitios públicos: los datos quedan protegidos porque las tablas solo permiten leer y escribir a usuarios con sesión iniciada.

Para probar otra conexión en un solo teléfono: **Ajustes → Conexión con Supabase (avanzado)**.

### 3.5 Cómo funciona la sincronización
- Al pulsar **Guardar registro**, el registro se guarda **primero en el teléfono** y después se sube a la nube.
- Sin señal, queda como **"por subir"**; se sube solo al volver la conexión, al abrir la app o cada 2 minutos.
- La app descarga los registros de **todos los usuarios** (los 1 000 más recientes por módulo) para el historial, las gráficas y la estimación del manómetro.
- Cada registro guarda el correo del usuario que lo hizo.
- Para ver o descargar todo desde Supabase: **Table Editor** → tabla → **Export → CSV**. También existe la vista `resumen_mediciones` (registros por módulo y máquina).

## 4. Máquinas: QR y serie

- En cada módulo, la primera casilla es **Máquina Heat Transfer**. Pulsa **Escanear QR** y apunta la cámara al código de la máquina, o escribe la serie (ej. `PH59`, `ph 59`, `7093`).
- El QR se reconoce por su enlace `http://gkd.bz/…` (Asset ID) o por el código de la columna QR. También se puede escribir el código.
- Al reconocerla, muestra serie, línea, estación, fabricante y cuántos registros tiene en ese módulo. Avisa si la máquina está **INACTIVA** en el inventario.
- La cámara requiere permiso del navegador y que la página esté en HTTPS (GitHub Pages ya lo usa).

**Datos del inventario que conviene revisar** (detectados al importar):
| Caso | Qué hace la app |
|---|---|
| `PH39` aparece dos veces (PH 39 CEROHS en LINE 37 y PH39 HENXING sin línea) | Muestra las dos para elegir. |
| PH33 tiene en la columna QR el enlace `http://gkd.bz/8XVQRQCN`, que es el Asset ID de PH35 | Al escanear ese código elige **PH35** (el Asset ID tiene prioridad). Revisa la etiqueta física de PH33. |
| Una máquina BEST BUY BY-14 (LINE 21) tiene SERIE = 0 | Se identifica como `QR XUAZWQMK`. |
| `p.h13` tiene GRUPO = SEWING MACHINE pero TIPO = HEAT TRANSFER | Se incluye (se filtra por TIPO). |

**Actualizar el inventario** cuando haya máquinas nuevas:
```bash
pip install openpyxl
python herramientas/generar-maquinas.py "INVENTARIO MAQUINAS.xlsx"
```
Luego sube `js/maquinas.js` y aumenta `VERSION` en `sw.js`.

## 5. Publicar la actualización en GitHub (tu repositorio pinehurst-dashboard)

La app está en `https://ar15011654.github.io/pinehurst-dashboard/medicion-transfer/`.

1. Descomprime `medicion-transfer.zip`.
2. Si ya creaste Supabase, edita `js/config.js` (sección 3.4). Si no, súbelo vacío: funcionará en modo local y lo puedes completar después.
3. Abre `https://github.com/AR15011654/pinehurst-dashboard/upload/main`.
4. Arrastra la **carpeta completa `medicion-transfer`** al recuadro. GitHub reemplaza los archivos que cambiaron y agrega los nuevos (`js/db.js`, `js/config.js`, `js/maquinas.js`, `js/jsQR.js`, `supabase/`, `herramientas/`).
5. **Commit changes**. En 1–3 minutos estará publicada.
6. En los teléfonos: abre la app con internet, ciérrala y vuelve a abrirla para cargar la versión 2.

> `sw.js` ya tiene `VERSION = 'v2.0.0'`. En cada actualización futura, aumenta ese número.

## 6. Uso diario

1. **Ajustes (engrane):** capacidad máxima de la celda (una vez por teléfono) e inicio de sesión.
2. **Cálculo de presión:** máquina → rubber → presión deseada → fuerza objetivo del dinamómetro → **Guardar registro**.
3. **Validación de presión:** máquina → rubber → lectura estable del dinamómetro → presión promedio sobre el rubber (y, si aplica, sobre la plancha completa) → **Guardar registro**. *Pasar a registro de pruebas* copia los datos.
4. **Registro de pruebas:** máquina, montaje, rubber, manómetro y fuerza; guarda varias pruebas con distintos ajustes del manómetro. Gráfica por máquina + rubber + montaje y **ESTIMACIÓN** del ajuste del manómetro (requiere ≥ 2 ajustes distintos de la misma máquina y montaje; si no, muestra *"No es posible determinar el ajuste del manómetro sin mediciones de esta máquina y este montaje"*).
5. **Historial y reportes:** pestañas Cálculo / Validación / Pruebas, filtro por máquina, Excel, CSV, PDF, compartir y respaldo.

## 7. Fórmulas (verificadas: 87 pruebas automáticas)

| Cálculo | Fórmula |
|---|---|
| Área (cm²) | largo × ancho |
| Área (in²) | cm² ÷ 6.4516 |
| Fuerza (lbf) | psi × in² |
| kgf / N | lbf ÷ 2.20462262185 / lbf × 4.44822161526 |
| Lectura mínima / máxima (catálogo) | presión mínima y máxima del rango aprobado × área (in²); un valor único da una sola lectura |
| Presión (psi) | lbf ÷ in² |
| kgf/cm² / bar | psi ÷ 14.2233 / psi ÷ 14.5038 |

Ejemplos verificados: rubber 4 × 2 cm a 20–30 psi → mínima **24.80 lbf**, máxima **37.20 lbf**; rubber 4.5 × 1.1 cm a 40 psi → **30.69 lbf**; rubber 4 × 2 cm a 20 psi → **24.80 lbf = 11.25 kgf = 110.32 N**; 30 lbf sobre 4.5 × 1.1 cm → **39.10 psi**.

Que el cálculo sea correcto no valida la medición física: el resultado solo representa la presión real si el dinamómetro mide toda la fuerza que pasa por el área efectiva del rubber.

## 8. Sin conexión

| Función | ¿Sin internet? |
|---|---|
| Calcular, validar, registrar pruebas, escanear QR, guardar registros | Sí (quedan "por subir") |
| Historial, gráficas, exportar Excel/CSV/PDF | Sí (con los datos ya descargados) |
| Iniciar sesión, sincronizar, primera carga, actualizaciones | Requiere internet |

## 9. Seguridad

- En GitHub solo van la URL del proyecto y la clave **anon/publishable** (públicas por diseño). La protección está en las reglas de la base de datos (RLS): sin sesión no se puede leer ni escribir (comprobado).
- **Nunca** subas la clave `service_role`/`secret` ni la contraseña de la base de datos.
- El inventario de máquinas (serie, QR, línea) va dentro de la app y es visible para quien abra la dirección pública; los **registros de medición no**, porque viven en Supabase y requieren sesión.
- Desactiva el registro libre de usuarios (sección 3.3). Para dar de baja a alguien: *Authentication → Users → Delete user*.
- Mejoras futuras posibles: roles (solo supervisores eliminan), bitácora de cambios, y mover el inventario a una tabla protegida.

## 10. Avisos de medición

- La presión calculada es un promedio estimado. Para que sea representativa, el dinamómetro debe medir la fuerza total que pasa por el área efectiva de contacto del rubber. La presión puede variar entre el centro y las esquinas.
- El manómetro mide presión del aire; el dinamómetro mide fuerza.
- Confirma la capacidad y temperatura máxima de la celda antes de usarla.
- No utilices los cálculos como ajuste de producción sin validar el montaje y los requisitos del proveedor del logo.
