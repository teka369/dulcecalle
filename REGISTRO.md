# Registro de Dulce Calle

El alta pública no crea una cuenta. Crea una solicitud. La persona entra solo cuando confirma su correo **y** un administrador aprueba.

Las cuentas que ya existían no pasan por este flujo. Su correo, su contraseña y su rol no cambian. El método interno `IdentityService.register` sigue creando un dueño directo para las pruebas y la semilla; no está publicado en HTTP.

## Qué pide el formulario

Nombre, correo, contraseña y confirmación. La confirmación no se guarda. No se piden teléfono, documento ni dirección. La contraseña tiene entre 8 y 72 caracteres.

## Estados

| Estado | Qué significa | ¿Puede entrar? |
|---|---|---|
| `PENDING_EMAIL_VERIFICATION` | Falta abrir el enlace | No |
| `PENDING_ADMIN_APPROVAL` | Correo confirmado, falta un administrador | No |
| `APPROVED` | Ya existe `users` + negocio + membresía `owner` | Sí |
| `REJECTED` | Un administrador dijo que no | No. El formulario no la reactiva |
| `EXPIRED` | El enlace o el plazo de 7 días venció | No, hasta que vuelva a registrarse |

Un correo sin confirmar no llega al administrador. Abrir el enlace no aprueba la cuenta. Aprobar y rechazar son `POST` con sesión de administrador. No hay un enlace mágico de aprobación.

Una solicitud `REJECTED` no se reactiva desde el formulario ni desde el reenvío. El correo queda reservado. Para dejar que esa persona vuelva a pedir acceso hay que borrar la solicitud a mano (ver recuperación). Una solicitud `EXPIRED` sí puede volver a pedir el enlace.

## Arquitectura

- El navegador (Next.js) habla con Nest por `/v1`. No crea filas en `users`.
- `RegistrationService` guarda la solicitud, el hash bcrypt de la contraseña y solo el SHA-256 del enlace.
- El enlace de verificación se envía en el acto (`MailService.sendNow`). No se escribe en `email_outbox`, para no guardar el secreto.
- El resto de los correos (aviso al administrador, solicitud recibida, aprobada, rechazada, vencida, "ya tienes cuenta") entra en `email_outbox` dentro de la misma transacción que el cambio de estado. Después del commit se intenta enviar. Si SMTP falla, la fila queda con `sent_at` vacío y se reintenta al abrir el listado, hasta 5 veces. La clave `dedupe_key` impide un segundo aviso por el mismo hecho.
- Aprobar crea usuario, negocio y membresía `owner` en una transacción. Si el correo ya es una cuenta, la transacción se deshace y la solicitud sigue pendiente.
- Quién puede aprobar no es un rol de la tienda. Es el correo de `PLATFORM_ADMIN_EMAILS`, comprobado en el servidor contra el usuario real de la base. El menú de Más solo esconde el enlace; no es la autorización.

## Flujo

1. La persona envía nombre, correo, contraseña y confirmación.
2. Si el correo ya es una cuenta, la respuesta es la misma y, como máximo una vez al día, se le escribe "ya tienes cuenta".
3. Si no hay solicitud, se crea `PENDING_EMAIL_VERIFICATION` y se manda el enlace. Si el envío falla, se borra la fila y la API responde 503.
4. Abrir `/register/verificar?token=` hace `POST /auth/register/verify`. El enlace es de un solo uso. La solicitud pasa a `PENDING_ADMIN_APPROVAL`. Ahí se encola el aviso al administrador.
5. Un administrador abre `/admin/registros`, confirma y aprueba o rechaza.
6. Si aprueba, la persona entra en `/login` con la misma contraseña. Su membresía es `owner` de un negocio nuevo, con el nombre que escribió. No queda como administrador de la plataforma salvo que ese correo ya estuviera en `PLATFORM_ADMIN_EMAILS`.

## Endpoints

Todos bajo `/v1`.

- `POST /auth/register`
- `POST /auth/register/verify` con `{ token }`
- `POST /auth/register/resend` con `{ email }`
- `GET /admin/registrations?status=`
- `GET /admin/registrations/:id` (incluye historial)
- `POST /admin/registrations/:id/approve`
- `POST /admin/registrations/:id/reject` con `{ note? }`

La respuesta de alta y de reenvío es siempre la misma si los datos son válidos, para no decir si el correo ya existe. Si el correo ya es una cuenta, se envía un aviso de "ya tienes cuenta" como máximo una vez al día.

Si la contraseña coincide con una solicitud, el login dice en qué estado está. Si no coincide, responde lo mismo que un correo desconocido.

## Correo

El remitente (`MAIL_*`) y el buzón que revisa solicitudes (`REGISTRATION_ADMIN_EMAIL`) son cosas distintas.

| Variable | Uso |
|---|---|
| `MAIL_HOST` `MAIL_PORT` `MAIL_USER` `MAIL_PASSWORD` `MAIL_FROM` `MAIL_SECURE` | SMTP que envía |
| `REGISTRATION_ADMIN_EMAIL` | Quién recibe "hay una solicitud por aprobar" |
| `APP_PUBLIC_URL` | Enlaces de los correos. En producción: `https://dulcecalle.vercel.app` |
| `PLATFORM_ADMIN_EMAILS` | Correos que **ya pueden entrar** y pueden aprobar. Separados por coma |
| `TURNSTILE_SECRET_KEY` | Opcional. Si está vacío, no se exige captcha |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | La misma pareja, en Vercel, para mostrar el widget |

Sin `MAIL_HOST` y `MAIL_FROM`, producción responde 503 y no guarda la solicitud. En desarrollo y en pruebas el mensaje se captura en memoria.

Plantillas: verificación, solicitud recibida (al confirmar el correo), aviso al administrador, cuenta aprobada, solicitud rechazada, enlace vencido, ya tienes cuenta.

El aviso al administrador se encola una sola vez por solicitud (`email_outbox.dedupe_key`) y solo después de confirmar el correo. Si el envío falla, el panel lo reintenta al abrir la lista (máximo 5 intentos). El enlace de verificación no se guarda en la base: solo su SHA-256. Dura 24 horas y se invalida al usarse. Un reenvío invalida el anterior. Hay espera de 60 segundos y un tope de 5 reenvíos por hora: pasada esa hora el contador vuelve a cero. El formulario, después del aviso, tiene "Reenviar enlace".

### SMTP

No se envió correo real en esta revisión: no hay credenciales de un proveedor. Con `NODE_ENV` distinto de `production` y sin `MAIL_HOST`, el mensaje se guarda en memoria y las pruebas leen el enlace ahí.

Para probar el envío real, en el servicio de Render (no en el chat):

| Variable | Ejemplo |
|---|---|
| `MAIL_HOST` | `smtp-relay.brevo.com` o `smtp.resend.com` |
| `MAIL_PORT` | `587` |
| `MAIL_SECURE` | `false` en 587, `true` en 465 |
| `MAIL_USER` | usuario SMTP del proveedor |
| `MAIL_PASSWORD` | clave SMTP |
| `MAIL_FROM` | un remitente que el proveedor ya verificó |
| `REGISTRATION_ADMIN_EMAIL` | el buzón que debe revisar solicitudes |
| `APP_PUBLIC_URL` | `https://dulcecalle.vercel.app` |

Brevo y Resend sirven. No hace falta contratarlos desde aquí. Después de cargarlos, un alta de prueba con un correo propio tiene que llegar en menos de un minuto. Si no llega, `email_outbox.last_error` queda en `smtp_failed` y `attempts` sube. No mires los logs buscando la contraseña ni el enlace: no se escriben.

Si la fila se guardó y el correo de verificación falló, la fila se borra y el cliente recibe 503. Puede reintentar. Si el proceso se cae justo después de guardar y antes de SMTP, la solicitud queda sin correo; a los 60 segundos el mismo formulario puede pedir otro enlace.

### Turnstile

Si `TURNSTILE_SECRET_KEY` está vacío, el backend no pide captcha. Si tiene valor, `turnstileToken` es obligatorio y se comprueba contra `https://challenges.cloudflare.com/turnstile/v0/siteverify`. El widget del navegador solo aparece si el build de Vercel tiene `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Cambiar esa variable exige un build nuevo. Sin las dos claves, honeypot y el límite por IP siguen activos.

## Panel

`/admin/registros`, dentro de la sesión de la tienda. En Más aparece "Solicitudes de registro" solo si `GET /v1/me` dice `platformAdmin: true`. Aprobar y rechazar piden confirmación en el navegador. Cada decisión guarda fecha, administrador e historial en `registration_decision_logs`.

`PLATFORM_ADMIN_EMAILS` tiene que ser el correo con el que esa persona ya entra. No crea usuarios.

## Abuso

- Límite por IP en `POST /auth/register` (8 cada 15 minutos) y en el reenvío (5 cada 15 minutos). No es un bloqueo permanente.
- Campo oculto `companyWebsite`. Si viene lleno, la API responde éxito y no guarda nada.
- Turnstile solo si configuras el secreto.
- Contraseña con bcrypt (coste 12), igual que el resto del proyecto. No se cambió a Argon2 para no meter otro algoritmo junto a los hashes que ya existen.
- Tope de 72 caracteres (bcrypt ignora el resto en silencio).
- El panel exige el JWT de un usuario real cuyo correo esté en `PLATFORM_ADMIN_EMAILS`.

## Datos

Migración aditiva `20261117120000_registration_requests`. No borra ni reescribe `users`.

Al aprobar, en una transacción: se marca la solicitud, se anula el hash del enlace, se crea el usuario con el hash ya guardado, un negocio (el nombre de la persona) y la membresía `owner`. Repetir la aprobación no crea otro usuario. Si el correo ya existe, no queda una solicitud aprobada sin usuario.

La migración solo crea el enum `RegistrationStatus` y las tablas `registration_requests`, `registration_decision_logs` y `email_outbox`, con sus índices y llaves. No hace `UPDATE` ni `DELETE` sobre `users`, `businesses` ni `business_memberships`. `ON DELETE RESTRICT` impide borrar un usuario que ya decidió o que nació de una solicitud sin borrar antes el historial.

## Seguridad

- La respuesta de alta no dice si el correo existe. El login solo dice el estado de la solicitud cuando la contraseña coincide; si no, es el mismo 401 que un correo desconocido.
- El límite por IP es de Nest (`ThrottlerGuard`), no un bloqueo permanente.
- El token sale de `crypto.randomBytes(32)` y en la base solo está su SHA-256. Comparar dos hashes usa `timingSafeEqual`.
- No hay cookie de sesión en estos POST. El panel manda `Authorization: Bearer`. Un sitio ajeno no puede aprobar por el navegador de la víctima.
- El DTO de alta no acepta rol, `userId` ni `businessId` (`whitelist` + `forbidNonWhitelisted`). El `owner` lo pone el servidor, y siempre en un negocio nuevo.
- Un JWT de staff o de dueño que no esté en `PLATFORM_ADMIN_EMAILS` recibe 403. Sin JWT, 401. `GET` de aprobar no existe.
- `REJECTED` no se puede reabrir ni cambiarle la contraseña desde el formulario.
- Los logs de error guardan código, usuario y estado. No guardan contraseña, token ni cuerpo del correo.
- Queda un hueco conocido: quien conozca un correo con solicitud aún no confirmada puede, pasado el minuto de espera, reemplazar el nombre y la contraseña de esa solicitud. No puede confirmarla sin el buzón, porque el enlace nuevo llega ahí y el anterior muere. El tope es 5 reenvíos por hora.
- Con SMTP caído, un alta nueva y una cuenta ya existente responden 503. Una solicitud ya rechazada o ya pendiente de aprobación responde el 201 genérico, porque no necesitan correo. Eso solo distingue esos estados mientras el correo esté caído.

## Despliegue

`main` es lo que Render despliega solo. Este documento no autoriza el merge. El PR tiene que seguir abierto hasta que se revisen las variables.

Orden, cuando se decida:

1. Confirmar que el workflow `registration` está en verde.
2. Merge a `main`. Render corre `prisma migrate deploy` antes de `node dist/main.js`.
3. Cargar las variables de correo y `PLATFORM_ADMIN_EMAILS` con el correo que ya entra. Sin `MAIL_HOST` y `MAIL_FROM`, el alta nueva responde 503 y el resto de la app sigue.
4. Opcional: Turnstile en Render y en Vercel, y volver a publicar el frontend para que el widget exista.
5. Probar con un correo que no sea el de la cuenta actual: alta, enlace, Más → Solicitudes, aprobar, entrar.

## Recuperación

- SMTP caído y el alta respondió 503: no quedó solicitud. Reintentar cuando el proveedor responda.
- Solicitud creada y el enlace no llegó: esperar 60 segundos y usar "Reenviar enlace", o enviar otra vez el formulario.
- Aviso al administrador atascado: abrir el listado (reintenta la bandeja de salida) o leer `email_outbox` donde `sent_at` es null. No reenviar a mano el enlace de verificación desde esa tabla: no está ahí.
- Aprobación a medias no debería quedar: usuario, negocio y membresía nacen en la misma transacción. Si el correo del solicitante ya era una cuenta, la solicitud sigue en `PENDING_ADMIN_APPROVAL`.
- Dejar que un correo rechazado vuelva a registrarse, solo con respaldo y a conciencia:

```sql
DELETE FROM registration_decision_logs WHERE request_id = '<uuid>';
DELETE FROM registration_requests WHERE id = '<uuid>' AND status = 'REJECTED';
```

No ejecutes eso en la base de producción como parte de este cambio.

## Pendiente del propietario

- Elegir proveedor SMTP, cargar las variables en Render y probar un envío real.
- Poner en `PLATFORM_ADMIN_EMAILS` el correo con el que ya entra el administrador.
- Decidir si Turnstile se enciende. Si sí, site key en Vercel y secret en Render.
- Hacer el merge cuando el envío real esté visto. Este cambio no lo hace.
- Opcional: un connection string de una rama de Neon de **prueba** si se quiere ver la migración fuera de Render. No usar la URL de producción.

## Pagos, más adelante

La cuenta (`users`), la verificación, la aprobación y el acceso son cosas distintas. Hoy el acceso es "existe el usuario". Un pago futuro no debería activarse desde el navegador: haría falta un webhook firmado, idempotente, que escriba el derecho de acceso. No hay pasarela en este cambio.

## Pruebas

Contra PostgreSQL aislado (no Neon):

```bash
cd backend
npm test -- --runInBand src/identity/registration-policy.unit-spec.ts test/registration.e2e-spec.ts test/registration-throttle.e2e-spec.ts
```

Pantallas, con el frontend ya construido:

```bash
npx playwright test e2e/registration-ui.spec.ts
```

Ese archivo no llama a Render ni a Neon: intercepta `/v1`. El widget de Turnstile no se prueba en el navegador mientras el build no tenga `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. El servidor sí se prueba en `registration-policy.unit-spec.ts`.

En GitHub Actions, el workflow `registration` corre las pruebas de Nest contra PostgreSQL 16. No usa Neon ni la base de producción. No corre Playwright.

## Para ponerlo en producción

1. Merge del PR. Render aplica la migración al arrancar (`prisma migrate deploy`). Mientras no pongas el correo, el alta nueva responde 503 y el resto de la app sigue.
2. En Render, servicio `dulcecalle-teka369`, completa `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `REGISTRATION_ADMIN_EMAIL`, `PLATFORM_ADMIN_EMAILS` (tu correo de entrada actual) y `APP_PUBLIC_URL=https://dulcecalle.vercel.app`.
3. Opcional: Turnstile en Render (`TURNSTILE_SECRET_KEY`) y en Vercel (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`).
4. Entra con tu cuenta, abre Más → Solicitudes, y prueba un alta con un correo que no sea el tuyo.

No hace falta pegar la URL de Neon para este cambio. La migración es aditiva y corre en el arranque de Render. Si quieres que la revise en una rama de Neon antes del merge, hace falta un connection string de **prueba**, no el de producción.
