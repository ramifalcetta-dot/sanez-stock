# Sánez Stock

Primera versión funcional de una app web instalable para controlar stock y precios. Está pensada para iPhone, funciona sin backend y guarda los datos únicamente en el dispositivo.

**Estado de la entrega:** lista para revisión local de Ramiro. No se publicó ni se contrató ningún servicio. Safari, la instalación en pantalla de inicio y el modo avión todavía deben verificarse en un iPhone real.

## Ejecutar la revisión local

Requisito: Node.js. Se probó con Node.js 24. No hay dependencias para instalar.

```bash
cd "C:\Users\ramif\OneDrive\Sanez-Stock"
npm start
```

Abrir `http://127.0.0.1:8080` en el navegador. Para detener el servidor, usar `Ctrl+C`.

No abrir `index.html` con doble clic: los módulos, IndexedDB y el modo offline deben probarse mediante el servidor local. Esta dirección solo permite revisar desde esta computadora; no expone la app a otros dispositivos.

## Primer ingreso y uso

- **Probar con ejemplos:** crea productos, cantidades y precios claramente ficticios. Desde **Respaldo → Salir del modo ejemplo** se puede pasar al catálogo real con confirmación, sin mezclar datos.
- **Empezar con mi stock:** carga 9 productos identificados en el catálogo, todos con stock en cero, mínimo en cero, una unidad por paquete y precios actuales “Sin cargar”. Hay que confirmar y cargar las cantidades, los paquetes, los mínimos y los precios reales.
- **Entró / Salió mercadería:** acepta unidades o paquetes. Un paquete descuenta o suma la cantidad de unidades configurada. No permite stock negativo.
- **Editar:** permite cambiar nombre, medida, paquete, mínimo y precios. También permite archivar y desarchivar sin borrar stock ni historial.
- **Historial:** conserva entradas, salidas, cambios de datos y archivados. Cada movimiento guarda el nombre, el paquete y los precios que tenía el producto en ese momento. Una corrección agrega un registro con motivo y enlace al original; nunca reemplaza silenciosamente el original.
- **Buscar:** acepta nombre o medida, sin distinguir tildes. Las medidas pueden escribirse como `30x22` o `30 × 22`.

Las valoraciones incluyen también productos archivados que todavía tienen stock. Si falta un precio en un producto con existencias, el total aparece como **Incompleto** y muestra solo el parcial conocido. La valoración de venta es una estimación por unidad, no dinero cobrado; el precio opcional por paquete no se usa para ese cálculo.

## Catálogo y precios de referencia

El archivo de origen se conserva en `reference/catalogo-sanez-09-2026.pdf`. Aunque su nombre original incluye “octubre”, sus páginas indican **LISTA DE PRECIOS 09/2026**.

Al editar un producto del catálogo se muestran sus precios de referencia con fecha y archivo de procedencia. Esas cantidades son opciones de venta de la lista, **no existencias ni configuración de paquetes**. Los precios de lista no se cargan como costos de compra ni como precios actuales confirmados.

Quedaron anotadas dentro de la app, sin crear fichas dudosas:

- `30 × 9 × 22`: podría coincidir con la caja `30 × 22 × 9`; requiere confirmación antes de unificar.
- `25 × 8 × 20`: producto pendiente de identificar.
- `12 × 6,5 × 12`: producto pendiente de identificar.

## Privacidad, persistencia y respaldos

- Los datos estructurados se guardan automáticamente en **IndexedDB**.
- No hay cuentas, IA, backend, sincronización, analítica ni envío de productos, precios o movimientos.
- Cada dispositivo y cada navegador tiene datos independientes. El segundo iPhone no recibirá los datos del primero.
- Después de una primera carga correcta, los recursos quedan disponibles offline mediante un service worker. En algunos navegadores hace falta abrir o recargar una segunda vez para que la página quede controlada.
- **Guardar copia** genera un JSON con productos, stock, precios, referencias, configuración e historial. El usuario decide dónde guardarlo; no hay integración directa con nubes.
- **Recuperar copia** valida el contenido, muestra un resumen y pide confirmación antes de reemplazar los datos actuales.
- La fecha visible es la de la última copia generada, no una confirmación de que el usuario la haya movido a otro servicio.

**El almacenamiento local no reemplaza un respaldo.** Borrar los datos del sitio, desinstalar la app, limpiar el navegador o una liberación de espacio del sistema puede eliminar la información. Conviene guardar copias periódicas en más de un lugar seguro.

## Instalación en iPhone

La instalación completa requiere una dirección **HTTPS**. Una vez publicada con autorización:

1. Abrir la dirección en Safari, con internet.
2. Esperar a que cargue y elegir el modo de inicio.
3. Tocar **Compartir → Agregar a pantalla de inicio**.
4. Confirmar el nombre **Sánez Stock** y el ícono del logo.
5. Abrir desde el ícono, cerrar y volver a abrir para comprobar la persistencia y el funcionamiento independiente del navegador.

No usar otro navegador para agregarla si se quiere el flujo estándar de Apple. La primera carga necesita internet.

## Pruebas manuales pendientes en iPhone real

### Safari

1. Abrir la URL HTTPS y comprobar que no aparezcan errores ni recursos sin cargar.
2. Elegir **Probar con ejemplos** y confirmar que el aviso de datos ficticios sea visible. Salir del ejemplo y verificar que no quede mezcla.
3. Elegir **Empezar con mi stock**. Confirmar que las cantidades sean cero y los precios actuales digan “Sin cargar”.
4. Agregar un producto con 4 unidades por paquete, stock inicial 12, compra `10,50` y venta `21`. Registrar una entrada de 2 paquetes: debe quedar en 20.
5. Intentar una salida de 21: debe rechazarse sin cambiar el stock. Registrar una salida de 3: debe quedar en 17.
6. Corregir la salida de 3 a 2 con un motivo: el stock debe quedar en 18 y el registro original debe seguir visible.
7. Cambiar nombre, paquete y precios. Verificar que los movimientos anteriores conserven sus valores originales.
8. Buscar por nombre y por medida. Configurar un mínimo y comprobar el aviso de stock bajo.
9. Dejar un precio vacío en un producto con stock: la valoración correspondiente debe decir “Incompleto”.
10. Archivar el producto y comprobar que su historial continúe. Desarchivarlo.
11. Cerrar Safari y volver a abrir la URL: los datos deben persistir.

### App agregada a inicio y modo avión

1. Instalar desde Safari y verificar nombre, ícono y apertura a pantalla completa.
2. Hacer un cambio, cerrar la app desde el selector de aplicaciones y reabrirla: el cambio debe permanecer.
3. Activar **modo avión**, cerrar completamente la app y abrirla desde el ícono. Deben aparecer productos y datos sin internet.
4. En modo avión, probar búsqueda, entrada, salida, edición, corrección e historial. No deben aparecer intentos de sincronización.
5. Usar **Guardar copia** y guardar el archivo en Archivos. Anotar su nombre y ubicación.
6. Hacer otro cambio y luego usar **Recuperar copia**. Verificar el resumen, cancelar una vez para comprobar que no reemplaza y repetir confirmando para recuperar.
7. Repetir una apertura offline después de recuperar.
8. En un segundo iPhone, abrir la misma URL: debe comenzar sin los datos del primero.

Si alguna prueba falla, anotar modelo de iPhone, versión de iOS, si estaba abierta en Safari o desde el ícono, y el paso exacto.

## Pruebas automáticas realizadas

```bash
npm test
npm run test:browser
```

- **21 pruebas unitarias/estáticas correctas:** cálculos, centavos, paquetes, cantidades inválidas, desbordes, stock negativo, mínimos, búsqueda, precios faltantes, edición, archivo, inmutabilidad histórica, correcciones, independencia del ejemplo, exportación, restauración y rechazo de respaldos inconsistentes. También se verifican manifiesto, íconos y recursos offline.
- **11 comprobaciones de navegador correctas en Microsoft Edge:** alta mediante la interfaz, IndexedDB, entrada por paquetes, rechazo de salida inválida, corrección, persistencia tras recarga, descarga del respaldo, recuperación mediante un archivo real, recarga offline y ausencia de solicitudes externas. Se ejecutó con viewport móvil de 390 × 844.
- Se hizo una revisión visual de las pantallas de primer ingreso y stock en modo oscuro.

La prueba de navegador usa Edge instalado en Windows. Si estuviera en otra ubicación, se puede definir `EDGE_PATH`. No reemplaza las pruebas pendientes en Safari ni en un iPhone físico.

## Propuesta de alojamiento HTTPS, todavía no realizada

Después de la revisión, se propone **GitHub Pages** en una dirección estable como:

`https://USUARIO.github.io/sanez-stock/`

El nombre definitivo depende de la cuenta que autorice Ramiro. Es adecuado porque la app es completamente estática y ofrece HTTPS sin backend.

Límites:

- El código y los recursos publicados son accesibles públicamente; no se deben incluir respaldos ni datos reales en el repositorio.
- El alojamiento gratuito está sujeto a las condiciones y cuotas vigentes del proveedor.
- No ofrece cuentas, base de datos, sincronización ni respaldo automático.
- Los datos siguen separados por dispositivo/navegador y las actualizaciones requieren publicar una nueva versión.
- GitHub Pages sirve la app, pero no recibe los movimientos ni las copias que el usuario guarda en su iPhone.

No se creó el repositorio, no se compró un dominio y no se publicó la app.

## Archivos principales

- `index.html`, `styles.css`: interfaz móvil basada en la referencia aprobada.
- `src/domain.js`: reglas de stock, precios, historial y respaldos.
- `src/catalog.js`: catálogo base y referencias 09/2026.
- `src/db.js`: persistencia en IndexedDB.
- `src/app.js`: pantallas e interacciones.
- `sw.js`, `manifest.webmanifest`, `assets/`: instalación y funcionamiento offline.
- `tests/`: pruebas automáticas sin dependencias externas.
