APP BARBERÍA - V1

1. Ejecuta schema.sql en el SQL Editor del mismo proyecto Supabase.
2. En supabaseClient.js configura la URL y el ANON KEY del proyecto. Actualmente son del mismo proyecto Supabase que usa la perfumería.
3. Crea un usuario en Authentication > Users.
4. Copia el UUID de cada persona autorizada a administrar el negocio y crea su perfil como admin con el SQL indicado al final de schema.sql. Solo las cuentas con `role='admin'` ven las ventas del negocio, las ganancias de la barbería y la configuración.
5. Crea los usuarios de recepción en Authentication > Users y asígnales perfil con `role='recepcionista'` (ejemplo abajo). Recepción registra los servicios, selecciona al barbero o administrador que los realizó, gestiona liquidaciones y cambia la frecuencia de pago entre diaria y semanal. Los administradores pueden registrar servicios para un barbero o para sí mismos; los barberos ya no pueden registrar servicios.
6. Para cada barbero: crea su usuario en Authentication > Users, copia el UUID y desde la sección Barberos de la app registra su nombre y comisión.
7. Para cambiar un perfil existente entre administrador, recepcionista y barbero, usa el SQL Editor de Supabase con el UUID de la persona:

```sql
update public.barberia_usuarios
set role = 'admin' -- o 'recepcionista' o 'barbero'
where id = 'UUID_DE_LA_PERSONA';
```

Haz administrador únicamente a quienes deban ver los ingresos y modificar el negocio. En la app, Servicios permite agregar, editar precios y desactivar/activar servicios.
8. Para actualizar una instalación existente, ejecuta en este orden: actualizar_servicios_multiple.sql, actualizar_roles_recepcion.sql y actualizar_liquidaciones.sql en Supabase.
9. Configura Yape y QR desde Configuración.
10. Para configurar pagos diarios/semanales y habilitar el registro de liquidaciones, ejecuta actualizar_liquidaciones.sql en el SQL Editor de Supabase.
11. Sube todos los archivos a GitHub Pages, Netlify o Vercel.

IMPORTANTE
- Esta app usa únicamente tablas con prefijo barberia_.
- No lee ni modifica las tablas de la app de perfumes.
- El bucket de archivos es barberia-comprobantes y las políticas de almacenamiento se limitan a ese bucket.
- Supabase Auth pertenece al proyecto compartido: las cuentas de inicio de sesión son comunes, pero los perfiles y permisos de barbería viven en barberia_usuarios. La sesión del navegador usa una clave propia para evitar que las apps se cierren o cambien de usuario entre sí en el mismo dominio.
- Para aislamiento completo, crea otro proyecto Supabase para la barbería y reemplaza su URL y ANON KEY en supabaseClient.js antes de ejecutar schema.sql allí. Eso separa también las cuentas Auth y el almacenamiento.
- La comisión queda guardada en cada corte para conservar el porcentaje histórico aunque después cambie la configuración.
- El precio, la comisión y los montos de cada corte se calculan en Supabase mediante un trigger, aunque un navegador intente enviar otros valores.
- Barba y cejas entregan el 100% de su precio al barbero. Para registrar varios servicios, editar el total y asociar cada registro al barbero atendiente, ejecuta actualizar_servicios_multiple.sql y actualizar_roles_recepcion.sql en el SQL Editor de Supabase.
- El campo Observaciones permite detallar pagos divididos, por ejemplo: S/ 10 en efectivo y S/ 15 por Yape. Para guardarlo en Supabase, actualiza ejecutando actualizar_roles_recepcion.sql.
- Los comprobantes se almacenan en el bucket privado barberia-comprobantes.

Para habilitar Servicios a recepcion (agregar, editar precios y activar/desactivar), ejecuta actualizar_servicios_recepcion.sql en el SQL Editor de Supabase.
