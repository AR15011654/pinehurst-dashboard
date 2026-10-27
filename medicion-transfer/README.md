# Medición Transfer — Fuerza y presión en el pegado de logos

Aplicación web para calcular la **fuerza** y la **presión promedio** aplicadas por máquinas transfer neumáticas durante el pegado de logos. Funciona en celular (Android y iPhone) y computadora, se puede instalar en la pantalla de inicio y trabaja **sin conexión** después de la primera carga.

> La app distingue siempre tres magnitudes distintas:
> 1. **Presión del aire** en el manómetro de la máquina (psi, bar o kgf/cm²).
> 2. **Fuerza** medida por el dinamómetro (lbf, kgf o N).
> 3. **Presión promedio calculada** sobre el área del rubber (psi, kgf/cm², bar).
>
> No existe una conversión directa entre 1 y 3: la relación depende de cada máquina, cilindro y montaje, y solo se obtiene midiendo.

---

## Contenido

1. [Funciones](#1-funciones)
2. [Estructura de carpetas](#2-estructura-de-carpetas)
3. [Fórmulas y verificación](#3-fórmulas-y-verificación)
4. [Subir el proyecto a GitHub](#4-subir-el-proyecto-a-github)
5. [Publicar gratis en GitHub Pages](#5-publicar-gratis-en-github-pages)
6. [Instalar en el celular](#6-instalar-en-el-celular)
7. [Uso diario](#7-uso-diario)
8. [Dónde se guardan los datos](#8-dónde-se-guardan-los-datos)
9. [Publicar actualizaciones](#9-publicar-actualizaciones)
10. [Seguridad](#10-seguridad)
11. [Evolución futura: usuarios y datos compartidos](#11-evolución-futura-usuarios-y-datos-compartidos)
12. [Avisos de medición](#12-avisos-de-medición)

---

## 1. Funciones

| Sección | Qué hace |
|---|---|
| **1. Fuerza necesaria** | Con largo y ancho del rubber (cm) y la presión deseada (psi), calcula el área (cm² e in²) y la fuerza necesaria en lbf, kgf y N. Incluye la **tabla de equivalencias** (por fuerza o por presión, con valor inicial, final e incremento) exportable a CSV o Excel. |
| **2. Presión medida** | Con la lectura del dinamómetro (lbf, kgf o N) calcula la fuerza en las tres unidades y la presión promedio sobre el rubber en psi, kgf/cm² y bar. Muestra opcionalmente el área de la plancha y, **solo si lo confirmas**, la presión promedio sobre la plancha completa, separada del resultado del rubber. |
| **3. Calibración** | Registro de pruebas por máquina: fecha, montaje, rubber, manómetro y su unidad, fuerza y su unidad, temperatura, tiempo y observaciones. Gráficas de fuerza vs. manómetro y presión en rubber vs. manómetro. **Estimación del ajuste del manómetro** solo con datos de la misma máquina, rubber y montaje. |
| **4. Historial y reportes** | Tabla de pruebas con filtro y búsqueda, editar y eliminar, exportar a **Excel (.xlsx)** y **CSV**, **imprimir o guardar en PDF**, compartir desde el celular, tablas de equivalencias por rubber, respaldo e importación. |
| **Ajustes (engrane)** | Capacidad máxima de la celda (lbf, kgf o N). Si la fuerza calculada o ingresada la alcanza o supera, aparece una alerta roja. Si no se ingresa, se indica "no verificada". |

Validaciones: se aceptan punto o coma decimal; las medidas y lecturas deben ser números mayores que cero. Los resultados se muestran con 2 decimales y los cálculos internos conservan la precisión completa (el área en in² muestra también 4 decimales como referencia).

## 2. Estructura de carpetas

```
medicion-transfer/
├── index.html              ← página principal (toda la interfaz)
├── manifest.webmanifest    ← permite instalar la app en el celular
├── sw.js                   ← service worker: funcionamiento sin conexión
├── .nojekyll               ← indica a GitHub Pages que publique los archivos tal cual
├── README.md               ← este documento
├── css/
│   └── styles.css          ← diseño (primero para celular)
├── js/
│   ├── calculos.js         ← fórmulas y conversiones (sin dependencias)
│   ├── xlsx-mini.js        ← generador de archivos Excel sin internet
│   └── app.js              ← lógica de pantallas, registros y exportaciones
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   └── apple-touch-icon.png
└── tests/
    └── pruebas-calculos.js ← pruebas automáticas de las fórmulas (opcional, Node.js)
```

No usa servidor, base de datos ni librerías externas. No hay que instalar nada para usarla.

## 3. Fórmulas y verificación

| Cálculo | Fórmula |
|---|---|
| Área (cm²) | largo × ancho |
| Área (in²) | cm² ÷ 6.4516 |
| Fuerza (lbf) a partir de presión | psi × in² |
| kgf | lbf ÷ 2.20462 |
| N | lbf × 4.44822 |
| lbf a partir de kgf | kgf × 2.20462 |
| lbf a partir de N | N ÷ 4.44822 |
| Presión (psi) | lbf ÷ in² |
| kgf/cm² | psi ÷ 14.2233 |
| bar | psi ÷ 14.5038 |
| Manómetro en bar → psi | bar × 14.5038 |
| Manómetro en kgf/cm² → psi | kgf/cm² × 14.2233 |

**Ejemplos comprobados** (37 pruebas automáticas, todas correctas):

| Caso | Resultado |
|---|---|
| Rubber 4.5 × 1.1 cm | 4.95 cm² = 0.7673 in² |
| 40 psi sobre ese rubber | 30.69 lbf = 13.92 kgf = 136.52 N |
| Plancha 20 × 30 cm | 600 cm² = 93.00 in² |
| Lectura 13.92 kgf en ese rubber | 30.69 lbf → 40.00 psi = 2.81 kgf/cm² = 2.76 bar |
| Lectura 50 lbf en ese rubber | 65.17 psi = 4.58 kgf/cm² = 4.49 bar |
| Manómetro 6 bar | 87.02 psi |

Para repetir las pruebas (opcional, requiere [Node.js](https://nodejs.org)):

```bash
node tests/pruebas-calculos.js
```

**Estimación del ajuste del manómetro.** Con las pruebas de una misma máquina + mismo rubber + mismo montaje se calcula una recta (mínimos cuadrados) entre la presión del manómetro (convertida a psi) y la fuerza medida. Para la presión deseada sobre el rubber se calcula la fuerza objetivo y se despeja el manómetro. Requisitos: al menos 2 pruebas con presiones de manómetro distintas y fuerza que aumente con la presión. Si no se cumplen, la app muestra: *"No es posible determinar el ajuste del manómetro sin mediciones de esta máquina y este montaje."* El resultado siempre se etiqueta como **ESTIMACIÓN** y advierte si queda fuera del rango medido o si los datos están dispersos.

## 4. Subir el proyecto a GitHub

### Opción A — Desde el navegador (sin programas)

1. Descomprime el archivo `medicion-transfer.zip` en tu computadora.
2. Entra a <https://github.com> e inicia sesión.
3. Arriba a la derecha pulsa **+** → **New repository**.
4. En **Repository name** escribe `medicion-transfer`.
5. Elige **Public** (GitHub Pages gratis requiere repositorio público en cuentas gratuitas; ver sección 10).
6. **No** marques "Add a README" (ya viene incluido). Pulsa **Create repository**.
7. En la página del repositorio vacío, pulsa el enlace **uploading an existing file**.
8. Abre la carpeta descomprimida `medicion-transfer`, selecciona **todo su contenido** (los archivos y las carpetas `css`, `js`, `icons`, `tests`) y arrástralo a la página de GitHub.
   - Arrastra el *contenido* de la carpeta, no la carpeta misma, para que `index.html` quede en la raíz.
   - El archivo `.nojekyll` está oculto en algunos sistemas; no es indispensable. En Windows: Explorador → Vista → mostrar *Elementos ocultos*. En Mac: `Cmd + Shift + .`.
9. Escribe un mensaje como `Primera versión` y pulsa **Commit changes**.
10. Comprueba que en la raíz del repositorio aparece `index.html`.

### Opción B — Con Git (línea de comandos)

```bash
cd medicion-transfer
git init
git add .
git commit -m "Primera versión de Medición Transfer"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/medicion-transfer.git
git push -u origin main
```

Cambia `TU-USUARIO` por tu usuario de GitHub. Si pide contraseña, usa un *Personal access token* o GitHub Desktop.

## 5. Publicar gratis en GitHub Pages

La app es solo HTML, CSS y JavaScript, así que GitHub Pages la publica directamente.

1. En el repositorio, entra a **Settings** (Configuración).
2. En el menú izquierdo, pulsa **Pages**.
3. En **Build and deployment → Source**, elige **Deploy from a branch**.
4. En **Branch**, elige `main` y la carpeta `/ (root)`. Pulsa **Save**.
5. Espera 1–3 minutos y recarga la página. Aparecerá la dirección:
   `https://TU-USUARIO.github.io/medicion-transfer/`
6. Abre esa dirección en el celular y en la computadora.

GitHub Pages usa HTTPS automáticamente, que es necesario para instalar la app y para el modo sin conexión.

## 6. Instalar en el celular

Abre la dirección de GitHub Pages **con internet** una vez.

- **Android (Chrome):** menú **⋮** → **Instalar app** o **Agregar a pantalla principal**. También aparece un botón *Instalar aplicación* en Ajustes (engrane) cuando el navegador lo permite.
- **iPhone (Safari):** botón **Compartir** (cuadro con flecha) → **Agregar a pantalla de inicio**. En iPhone debe hacerse desde Safari.

Queda un ícono "Transfer" que abre la app en pantalla completa.

### ¿Qué funciona sin conexión?

| Función | ¿Sin internet? |
|---|---|
| Calculadoras, tablas de equivalencias, calibración, gráficas, historial | Sí |
| Exportar Excel, CSV, PDF y respaldo | Sí (se generan en el teléfono) |
| Primera carga e instalación | **Requiere internet** |
| Recibir una versión nueva | **Requiere internet** |
| Enviar archivos por correo, WhatsApp, Teams, etc. | **Requiere internet** (lo hace la otra app) |

El indicador "En línea / Sin conexión" aparece arriba a la derecha.

## 7. Uso diario

1. **Ajustes (engrane):** ingresa la capacidad máxima de la celda una sola vez por dispositivo.
2. **Fuerza necesaria:** ingresa rubber y presión deseada → obtén la lectura objetivo del dinamómetro.
3. **Presión medida:** coloca la celda, aplica la plancha, anota la **fuerza estable** → obtén la presión promedio sobre el rubber. El botón *Usar en registro de calibración* copia los datos a la sección 3.
4. **Calibración:** para cada máquina y montaje, guarda varias pruebas con distintos ajustes del manómetro (por ejemplo 40, 50, 60, 70 psi). Al guardar, la máquina, el montaje y el rubber se conservan para capturar rápido la siguiente prueba.
5. Con 2 o más ajustes distintos, la app estima el ajuste del manómetro para la presión deseada. **Verifícalo siempre con una nueva medición.**
6. **Historial:** exporta a Excel o comparte desde el celular. *Imprimir / PDF* abre el diálogo de impresión: elige *Guardar como PDF*.

Consejos:
- Usa un nombre de montaje consistente (por ejemplo "Pecho izq. base A"); la estimación agrupa por máquina + rubber + montaje.
- El CSV usa coma como separador y punto decimal. Si tu Excel está configurado con coma decimal, usa la exportación **Excel (.xlsx)**.

## 8. Dónde se guardan los datos

> **Importante:** en esta primera versión los registros se guardan **solo en el navegador del dispositivo** (almacenamiento local).
>
> - **No se sincronizan** entre teléfonos ni con la computadora.
> - **Se pueden perder** si se borran los datos del navegador, se desinstala la app, se usa modo incógnito o el sistema libera espacio.
> - En iPhone, la app instalada y Safari guardan datos por separado.

Recomendaciones:
- Pulsa **Descargar respaldo** con frecuencia (archivo `.json`).
- Para pasar datos a otro dispositivo: descarga el respaldo y usa **Importar respaldo** en el otro. Los registros con el mismo identificador se reemplazan; los nuevos se agregan.
- Exporta a Excel los registros importantes y guárdalos en la carpeta de calidad de la planta.

## 9. Publicar actualizaciones

1. Modifica los archivos.
2. En `sw.js` cambia `var VERSION = 'v1.0.0';` por un número nuevo (por ejemplo `'v1.0.1'`). Si no lo haces, los teléfonos pueden seguir mostrando la versión anterior.
3. Opcional: actualiza `APP_VERSION` en `js/app.js`.
4. Sube los cambios a GitHub (*Add file → Upload files* o `git push`).
5. En los teléfonos, abre la app con internet y luego ciérrala y ábrela de nuevo.

Los registros guardados no se borran al actualizar.

## 10. Seguridad

- El proyecto **no contiene contraseñas, claves ni datos de la empresa**. No agregues claves de API, contraseñas ni datos confidenciales a los archivos: en un repositorio público cualquiera puede verlos, y aun en uno privado quedan en el historial de Git.
- Los registros **no se suben a GitHub**: viven en cada dispositivo. GitHub solo aloja el código.
- La página publicada en GitHub Pages es **pública**: cualquiera con la dirección puede abrir la calculadora (pero no ve tus registros).
- Repositorio privado + GitHub Pages requiere un plan de pago (GitHub Pro, Team o Enterprise); aun así, en planes que no son Enterprise el sitio publicado sigue siendo accesible para quien tenga la dirección.
- Exportaciones a CSV protegen contra fórmulas inyectadas (los textos que empiezan con `=`, `+`, `-`, `@` se prefijan con `'`).

## 11. Evolución futura: usuarios y datos compartidos

Para tener **inicio de sesión, acceso restringido y datos compartidos entre dispositivos**, hace falta un servicio en la nube con base de datos y autenticación. Opciones:

| Opción | Cuándo conviene |
|---|---|
| **Microsoft 365 / Entra ID + SharePoint List o Dataverse** (Power Apps, o la API de Microsoft Graph) | Si la planta ya usa cuentas de Microsoft: el acceso se controla con las mismas cuentas. |
| **Supabase** (PostgreSQL + autenticación) o **Firebase** (Firestore + Authentication) | Plan gratuito, se integra desde JavaScript; buena opción para seguir publicando en GitHub Pages o similar. |
| **Backend propio** (Node.js/Python + base de datos) en Azure, Render, etc. | Si se requiere integración con otros sistemas de la planta. |

Cambios necesarios en el código:

1. **Autenticación:** pantalla de inicio de sesión; cada registro guarda quién lo creó.
2. **Base de datos:** reemplazar `localStorage` (funciones `leerLS`/`guardarLS` en `js/app.js`) por llamadas a la base de datos. Conviene mantener una copia local y una cola de sincronización para seguir midiendo sin señal en planta.
3. **Roles y permisos:** por ejemplo *operador* (registra), *técnico de calidad* (edita/borra), *supervisor* (solo lectura y reportes). Aplicarlos en el servidor con reglas de seguridad (por ejemplo *Row Level Security* en Supabase o *Security Rules* en Firebase), no solo ocultando botones.
4. **Configuración segura:** las claves públicas del cliente (por ejemplo la *anon key* de Supabase) pueden ir en el código solo si las reglas de seguridad están bien configuradas; **las claves secretas o de servicio nunca** deben ir en GitHub ni en el navegador.
5. **Datos maestros:** catálogo de máquinas, montajes y celdas (con número de serie, capacidad y fecha de calibración) para seleccionarlos en lugar de escribirlos.
6. **Hosting con acceso restringido:** si la calculadora no debe ser pública, publicar en un servicio con control de acceso (por ejemplo Azure Static Web Apps con autenticación, Cloudflare Access o GitHub Enterprise con Pages privado).
7. **Auditoría:** guardar historial de cambios de cada registro.

## 12. Avisos de medición

Estos avisos aparecen en la aplicación junto a los resultados y en el reporte:

- La presión calculada es un promedio estimado. Para que sea representativa, el dinamómetro debe medir la fuerza total que pasa por el área efectiva de contacto del rubber. La presión puede variar entre el centro y las esquinas.
- El manómetro mide presión del aire; el dinamómetro mide fuerza.
- Confirma la capacidad y temperatura máxima de la celda antes de usarla.
- No utilices los cálculos como ajuste de producción sin validar el montaje y los requisitos del proveedor del logo.

Recomendaciones prácticas para la medición con el Omega DFG-RS3:
- Confirma en el equipo la unidad configurada (lbf, kgf o N) y que coincida con la unidad elegida en la app.
- Pon el indicador en cero sin carga antes de cada serie.
- Usa la lectura **estable** (o el modo pico, si lo que interesa es la fuerza máxima, y anótalo en observaciones).
- Protege la celda del calor de la plancha: muchas celdas tienen un límite de temperatura mucho menor que la temperatura de pegado. Verifica la hoja de datos de tu sensor.
- Coloca la celda centrada y usa una placa que reparta la carga en el área del rubber; si la celda solo toca una parte, la fuerza medida no representa todo el rubber.
- Repite cada ajuste al menos 3 veces para evaluar la repetibilidad.
