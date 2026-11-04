# Verificación local de reducción de tráfico

No se requieren dependencias, SQL ni cambios de RLS. La app sigue siendo estática y compatible con GitHub Pages. Al copiarla a otro alojamiento debe incluirse también `runtime.js`, antes de `app.js`, como declara `index.html`.

## Pruebas automatizadas

Ejecutar desde la carpeta del proyecto:

```text
node --check app.js
node --check runtime.js
node --test tests/traffic.test.cjs
```

Las pruebas usan un DOM y un cliente Supabase simulados. No inician sesiones reales, no transfieren imágenes privadas ni registran servicios o pagos reales.

Cubren comprobantes bajo demanda, reutilización y vencimiento de firmas, errores de firma, sesiones repetidas, cambio de usuario, cierre de sesión, respuestas antiguas, lecturas simultáneas, pantallas ocultas, QR, payload económico de servicios, selectores de pago, bloqueo de doble envío, recuperación del bloqueo e imágenes nuevas.

## Verificación manual pendiente en navegador

Usar un entorno autorizado con servicio Supabase disponible. En Network conservar la caché habilitada; no compartir tokens ni URLs firmadas en capturas o HAR sin sanitizarlos.

1. Entrar y recargar con sesión guardada: una carga inicial de datos, sin firmas ni GET de comprobantes. Renovar el token o cambiar de pestaña no debe volver a cargar toda la aplicación.
2. Abrir Historial y cambiar filtros: cero solicitudes de firma y cero imágenes de comprobantes. Pulsar Ver comprobante: una firma y la imagen; repetir antes del vencimiento reutiliza la firma. Un fallo debe permitir reintentar.
3. Abrir Registrar servicio: cargar Yape y NPS; volver a abrir y pasar a Configuración reutiliza las firmas. Ampliar debe funcionar. Cambiar un QR desde Configuración y guardar: verificar el nuevo QR y escanearlo. Guardar solo texto no debe volver a subir el archivo seleccionado anteriormente.
4. Registrar un servicio con varios ítems: comprobar total, comisiones, historial y liquidaciones con los mismos valores que antes. Hacer doble clic: un solo RPC. Repetir con comprobante de cámara y galería, y con un fallo de red. Tras confirmación del servicio y fallo de actualización, no volver a registrar la operación: usar Actualizar.
5. Probar JPG/WEBP grandes, PNG, HEIC y formatos inválidos; rechazar más de 12 MB. Revisar visualmente importes, texto pequeño y orientación de la foto optimizada. PNG, GIF, HEIC y QR conservan el archivo original; no se modifican archivos históricos.
6. Abrir Liquidaciones: una pareja de consultas, incluso con clics rápidos. Cambiar período durante una carga: solo debe quedar el período final. Registrar un pago autorizado, verificar método, nota e historial, y hacer doble clic para confirmar un solo RPC.
7. Cerrar sesión mientras carga una imagen o consulta y entrar con otro usuario: no reaparecen imágenes ni datos del anterior. Comprobar permisos con cuentas admin, recepción y barbero.
8. Registrar servicios sin visitar Historial o Liquidaciones: no debe haber firmas de comprobantes ni consultas de liquidaciones ocultas.

## Límites y riesgos

- Los bloqueos de envío están en el cliente y por pestaña: no constituyen idempotencia del servidor ante dos dispositivos ni ante una respuesta de escritura perdida. No se reintentan escrituras automáticamente.
- Las URLs firmadas quedan solo en memoria, con vigencia máxima de una hora y margen de renovación de un minuto. Se limpian al cambiar/cerrar sesión; una URL ya emitida puede seguir siendo válida en el servidor hasta su vencimiento. No se altera RLS.
- El cambio de sesión invalida respuestas y trabajo pendiente; no deshace escrituras que el servidor ya hubiera aceptado.
- Compresión conservadora: JPEG/WEBP nuevos, lado mayor de 2560 px y JPEG 92%, solo si resulta menor. La legibilidad necesita revisión manual con fotos reales. Formatos no decodificados se preservan.
- Se conserva el límite existente de 1.000 servicios y los cálculos actuales. La reducción real de bytes requiere comparar métricas antes/después; no se promete un porcentaje de ahorro.
- El historial reutiliza los datos de sesión y ofrece Actualizar para cambios hechos desde otro dispositivo. Liquidaciones se consulta cuando se invalida o al reabrir tras un minuto.
- No se ha publicado ni desplegado esta modificación.
