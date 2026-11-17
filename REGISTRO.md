# Registro de Dulce Calle

El alta pública no crea una cuenta. Crea una solicitud. La persona entra solo cuando confirma su correo **y** un administrador aprueba.

Las cuentas que ya existían no pasan por este flujo. Su correo, su contraseña y su rol no cambian. El método interno `IdentityService.register` sigue creando un dueño directo para las pruebas y la semilla; no está publicado en HTTP.

## Qué pide el formulario

Nombre, correo, contraseña y confirmación. La confirmación no se guarda. No se piden teléfono, documento ni dirección.

## Estados

| Estado | Qué significa | ¿Puede entrar? |
|---|---|---|
| `PENDING_EMAIL_VERIFICATION` | Falta abrir el enlace | No |
| `PENDING_ADMIN_APPROVAL` | Correo confirmado, falta un administrador | No |
| `APPROVED` | Ya existe `users` + negocio + membresía `owner` | Sí |
| `REJECTED` | Un administrador dijo que no | No |
| `EXPIRED` | El enlace o el plazo de 7 días venció | No, hasta que vuelva a registrarse |

Un correo sin confirmar no llega al administrador. Abrir el enlace no aprueba la cuenta. Aprobar y rechazar son `POST` con sesión de administrador. No hay un enlace mágico de aprobación.

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

Plantillas: verificación, solicitud recibida (al confirmar el correo), aviso al administrador, cuenta aprobada, solicitud rechazada, enlace vencido.

El aviso al administrador se encola una sola vez por solicitud (`email_outbox.dedupe_key`) y solo después de confirmar el correo. Si el envío falla, el panel lo reintenta al abrir la lista (máximo 5 intentos). El enlace de verificación no se guarda en la base: solo su SHA-256. Dura 24 horas y se invalida al usarse. Un reenvío invalida el anterior. Hay espera de 60 segundos y un tope de 5 reenvíos por hora.

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

Al aprobar, en una transacción: se marca la solicitud, se crea el usuario con el hash ya guardado, un negocio (el nombre de la persona) y la membresía `owner`. Repetir la aprobación no crea otro usuario.

## Pagos, más adelante

La cuenta (`users`), la verificación, la aprobación y el acceso son cosas distintas. Hoy el acceso es "existe el usuario". Un pago futuro no debería activarse desde el navegador: haría falta un webhook firmado, idempotente, que escriba el derecho de acceso. No hay pasarela en este cambio.

## Pruebas

```bash
cd backend
npm test -- --runInBand src/identity/registration-policy.unit-spec.ts test/registration.e2e-spec.ts test/registration-throttle.e2e-spec.ts
```

En GitHub Actions, el workflow `registration` corre lo mismo contra PostgreSQL 16. No usa Neon ni la base de producción.

## Para ponerlo en producción

1. Merge del PR. Render aplica la migración al arrancar (`prisma migrate deploy`). Mientras no pongas el correo, el alta nueva responde 503 y el resto de la app sigue.
2. En Render, servicio `dulcecalle-teka369`, completa `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `REGISTRATION_ADMIN_EMAIL`, `PLATFORM_ADMIN_EMAILS` (tu correo de entrada actual) y `APP_PUBLIC_URL=https://dulcecalle.vercel.app`.
3. Opcional: Turnstile en Render (`TURNSTILE_SECRET_KEY`) y en Vercel (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`).
4. Entra con tu cuenta, abre Más → Solicitudes, y prueba un alta con un correo que no sea el tuyo.

No hace falta pegar la URL de Neon para este cambio. La migración es aditiva y corre en el arranque de Render. Si quieres que la revise en una rama de Neon antes del merge, hace falta un connection string de **prueba**, no el de producción.
