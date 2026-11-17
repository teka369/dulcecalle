import { appPublicUrl } from "./platform-admin";

export type MailBody = { subject: string; text: string; html: string };

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#fff7f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7f2;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:28px 24px;font-family:Georgia, 'Times New Roman', serif;color:#3a2430;">
        <tr><td style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#c23b62;">Dulce Calle</td></tr>
        <tr><td style="padding-top:12px;font-size:22px;line-height:1.3;">${title}</td></tr>
        <tr><td style="padding-top:12px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#3a2430;">${body}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0;"><a href="${href}" style="display:inline-block;background:#c23b62;color:#ffffff;text-decoration:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;font-weight:600;padding:12px 18px;border-radius:999px;">${label}</a></p>`;
}

export function verificationMail(name: string, rawToken: string, env?: NodeJS.ProcessEnv): MailBody {
  const url = `${appPublicUrl(env)}/register/verificar?token=${encodeURIComponent(rawToken)}`;
  const text = [
    `Hola ${name},`,
    "",
    "Recibimos tu solicitud para entrar a Dulce Calle.",
    "Confirma que este correo es tuyo (el enlace vence en 24 horas):",
    url,
    "",
    "Confirmar el correo no activa la cuenta. Después alguien del equipo la revisa.",
    "Si no pediste esto, ignora este mensaje.",
  ].join("\n");
  return {
    subject: "Confirma tu correo en Dulce Calle",
    text,
    html: layout(
      "Confirma tu correo",
      `<p>Hola ${escapeHtml(name)},</p>
       <p>Recibimos tu solicitud. Este enlace vence en 24 horas y solo se puede usar una vez.</p>
       ${button(url, "Confirmar correo")}
       <p>Confirmar el correo no activa la cuenta. Después la revisamos nosotros.</p>
       <p style="color:#8a7280;font-size:13px;">Si no pediste esto, ignora este mensaje.</p>`,
    ),
  };
}

export function waitingReviewMail(name: string): MailBody {
  const text = `Hola ${name},\n\nTu correo quedó confirmado. La cuenta sigue pendiente de aprobación y todavía no puedes entrar.\nTe escribimos cuando haya una respuesta.`;
  return {
    subject: "Recibimos tu solicitud en Dulce Calle",
    text,
    html: layout(
      "Solicitud recibida",
      `<p>Hola ${escapeHtml(name)},</p><p>Tu correo quedó confirmado. La cuenta sigue pendiente de aprobación y todavía no puedes entrar.</p><p>Te escribimos cuando haya una respuesta.</p>`,
    ),
  };
}

export function adminNoticeMail(name: string, email: string, env?: NodeJS.ProcessEnv): MailBody {
  const url = `${appPublicUrl(env)}/admin/registros`;
  const text = `Hay una solicitud con el correo confirmado.\nNombre: ${name}\nCorreo: ${email}\nEntra al panel (hace falta iniciar sesión): ${url}\nNo apruebes desde este mensaje.`;
  return {
    subject: "Solicitud de registro por aprobar",
    text,
    html: layout(
      "Solicitud por aprobar",
      `<p><strong>${escapeHtml(name)}</strong> confirmó ${escapeHtml(email)}.</p>
       ${button(url, "Abrir el panel")}
       <p style="color:#8a7280;font-size:13px;">Este mensaje no aprueba la cuenta. La decisión se hace en el panel, con tu sesión.</p>`,
    ),
  };
}

export function approvedMail(name: string, env?: NodeJS.ProcessEnv): MailBody {
  const url = `${appPublicUrl(env)}/login`;
  const text = `Hola ${name},\n\nTu cuenta de Dulce Calle fue aprobada. Ya puedes entrar:\n${url}`;
  return {
    subject: "Tu cuenta de Dulce Calle fue aprobada",
    text,
    html: layout(
      "Cuenta aprobada",
      `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes entrar a tu tienda.</p>${button(url, "Entrar")}`,
    ),
  };
}

export function rejectedMail(name: string, note: string | null): MailBody {
  const extra = note?.trim() ? `\n\nNota: ${note.trim()}` : "";
  const text = `Hola ${name},\n\nNo aprobamos tu solicitud de Dulce Calle.${extra}\nSi crees que es un error, responde a este correo.`;
  return {
    subject: "Solicitud de Dulce Calle no aprobada",
    text,
    html: layout(
      "Solicitud no aprobada",
      `<p>Hola ${escapeHtml(name)},</p><p>No aprobamos tu solicitud.</p>${
        note?.trim() ? `<p>Nota: ${escapeHtml(note.trim())}</p>` : ""
      }<p>Si crees que es un error, responde a este correo.</p>`,
    ),
  };
}

export function expiredMail(name: string, env?: NodeJS.ProcessEnv): MailBody {
  const url = `${appPublicUrl(env)}/register`;
  const text = `Hola ${name},\n\nEl enlace para confirmar tu correo venció. Puedes pedir otro aquí:\n${url}`;
  return {
    subject: "Tu enlace de Dulce Calle venció",
    text,
    html: layout(
      "Enlace vencido",
      `<p>Hola ${escapeHtml(name)},</p><p>El enlace para confirmar tu correo venció.</p>${button(url, "Pedir otro enlace")}`,
    ),
  };
}

export function alreadyRegisteredMail(env?: NodeJS.ProcessEnv): MailBody {
  const url = `${appPublicUrl(env)}/login`;
  const text = `Ya existe una cuenta de Dulce Calle con este correo. Entra aquí:\n${url}\nSi no fuiste tú, ignora este mensaje.`;
  return {
    subject: "Ya tienes cuenta en Dulce Calle",
    text,
    html: layout(
      "Ya tienes cuenta",
      `<p>Ya existe una cuenta con este correo.</p>${button(url, "Entrar")}<p style="color:#8a7280;font-size:13px;">Si no fuiste tú, ignora este mensaje.</p>`,
    ),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}
