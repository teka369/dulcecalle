import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import type { Prisma, RegistrationRequest, RegistrationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES } from "../shared/errors";
import {
  adminNoticeMail,
  alreadyRegisteredMail,
  approvedMail,
  expiredMail,
  rejectedMail,
  verificationMail,
  waitingReviewMail,
} from "./email-templates";
import { MailService } from "./mail.service";
import { registrationAdminEmail } from "./platform-admin";
import { createOwnerAccount } from "./provision-owner";
import {
  MAX_RESENDS,
  REGISTER_ACCEPTED,
  REQUEST_TTL_MS,
  RESEND_GAP_MS,
  RESEND_LOCK_MS,
  TOKEN_TTL_MS,
  hashToken,
  isHoneypot,
  newEmailToken,
  normalizeEmail,
  canReplaceRegistrationCredentials,
} from "./registration-token";
import { assertTurnstile } from "./turnstile";

const DUMMY_HASH = bcrypt.hashSync("registration-dummy-password", 12);

const INVALID_LINK = "Este enlace ya no es válido. Si ya confirmaste el correo, espera la aprobación.";

type SubmitInput = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  companyWebsite?: string;
  turnstileToken?: string;
};

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async submit(dto: SubmitInput) {
    if (isHoneypot(dto.companyWebsite)) return REGISTER_ACCEPTED;
    await assertTurnstile(dto.turnstileToken);
    this.assertMailReady();
    const name = dto.name.trim();
    if (name.length < 2) throw new AppError(ERROR_CODES.VALIDATION, "Escribe tu nombre.");
    if (dto.password !== dto.confirmPassword) {
      throw new AppError(ERROR_CODES.VALIDATION, "Las contraseñas no coinciden.");
    }
    const email = normalizeEmail(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      await this.notifyAlreadyRegistered(email);
      return REGISTER_ACCEPTED;
    }
    const existing = await this.prisma.registrationRequest.findUnique({ where: { email } });
    if (!existing) {
      await this.createRequest(name, email, passwordHash);
      return REGISTER_ACCEPTED;
    }
    if (existing.userId || existing.status === "APPROVED") {
      await this.notifyAlreadyRegistered(email);
      return REGISTER_ACCEPTED;
    }
    // Knowing the email is not enough to change a live request. Only a closed
    // one (expired, or past its 7 day window) can be replaced by a new form.
    if (!canReplaceRegistrationCredentials(existing)) {
      return REGISTER_ACCEPTED;
    }
    await this.issueVerification(existing, { name, passwordHash, revive: true });
    return REGISTER_ACCEPTED;
  }

  async resend(emailRaw: string) {
    this.assertMailReady();
    const email = normalizeEmail(emailRaw);
    const row = await this.prisma.registrationRequest.findUnique({ where: { email } });
    if (!row) {
      await bcrypt.compare(email, DUMMY_HASH);
      return { ok: true as const };
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user || row.status === "APPROVED" || row.userId) {
      await this.notifyAlreadyRegistered(email);
      return { ok: true as const };
    }
    if (row.status === "PENDING_ADMIN_APPROVAL" || row.status === "REJECTED") {
      return { ok: true as const };
    }
    await this.issueVerification(row, { revive: row.status === "EXPIRED" });
    return { ok: true as const };
  }

  async verify(rawToken: string) {
    const token = rawToken.trim();
    const hash = hashToken(token);
    const row = await this.prisma.registrationRequest.findUnique({
      where: { emailTokenHash: hash },
    });
    if (!row || row.status !== "PENDING_EMAIL_VERIFICATION") {
      throw new AppError(ERROR_CODES.VALIDATION, INVALID_LINK);
    }
    const now = new Date();
    const tokenDead = !row.emailTokenExpiresAt || row.emailTokenExpiresAt.getTime() <= now.getTime();
    const requestDead = row.expiresAt.getTime() <= now.getTime();
    if (tokenDead || requestDead) {
      await this.expire(row);
      throw new AppError(
        ERROR_CODES.REGISTRATION_EXPIRED,
        "El enlace venció. Solicita uno nuevo desde el registro.",
      );
    }
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.registrationRequest.updateMany({
        where: { id: row.id, status: "PENDING_EMAIL_VERIFICATION", emailTokenHash: hash },
        data: {
          status: "PENDING_ADMIN_APPROVAL",
          emailTokenHash: null,
          emailVerifiedAt: now,
          emailTokenExpiresAt: null,
        },
      });
      if (updated.count !== 1) return false;
      await tx.registrationDecisionLog.create({
        data: { id: randomUUID(), requestId: row.id, action: "email_verified" },
      });
      await this.enqueueAdmin(tx, row);
      const waiting = waitingReviewMail(row.name);
      await this.mail.enqueue(tx, {
        dedupeKey: `registration:${row.id}:waiting`,
        kind: "registration_received",
        to: row.email,
        ...waiting,
      });
      return true;
    });
    if (!claimed) throw new AppError(ERROR_CODES.VALIDATION, INVALID_LINK);
    await this.mail.flushPending();
    return { status: "PENDING_ADMIN_APPROVAL" as const };
  }

  /**
   * Called when no User row exists. If the password matches a request, the
   * caller learns the real status. Otherwise this returns and login stays generic.
   */
  async assertPendingCredentials(emailRaw: string, password: string): Promise<void> {
    const email = normalizeEmail(emailRaw);
    const row = await this.prisma.registrationRequest.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !ok) return;
    if (row.status === "PENDING_EMAIL_VERIFICATION") {
      if (row.expiresAt.getTime() <= Date.now()) {
        await this.expire(row);
        throw new AppError(ERROR_CODES.REGISTRATION_EXPIRED, "La solicitud venció. Regístrate de nuevo.");
      }
      throw new AppError(
        ERROR_CODES.EMAIL_NOT_VERIFIED,
        "Confirma tu correo antes de entrar. Revisa tu bandeja.",
      );
    }
    if (row.status === "PENDING_ADMIN_APPROVAL") {
      throw new AppError(
        ERROR_CODES.PENDING_APPROVAL,
        "Tu correo está confirmado. Falta la aprobación de Dulce Calle.",
      );
    }
    if (row.status === "REJECTED") {
      throw new AppError(ERROR_CODES.REGISTRATION_REJECTED, "Esta solicitud no fue aprobada.");
    }
    if (row.status === "EXPIRED") {
      throw new AppError(ERROR_CODES.REGISTRATION_EXPIRED, "La solicitud venció. Regístrate de nuevo.");
    }
  }

  async list(status?: RegistrationStatus) {
    await this.mail.flushPending();
    const rows = await this.prisma.registrationRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: this.publicSelect,
    });
    return rows.map((row) => this.toPublic(row));
  }

  async get(id: string) {
    const row = await this.prisma.registrationRequest.findUnique({
      where: { id },
      select: {
        ...this.publicSelect,
        logs: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            action: true,
            note: true,
            createdAt: true,
            actor: { select: { email: true } },
          },
        },
      },
    });
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "No encontramos esa solicitud.");
    const { logs, ...rest } = row;
    return {
      ...this.toPublic(rest),
      history: logs.map((log) => ({
        id: log.id,
        action: log.action,
        note: log.note,
        createdAt: log.createdAt,
        actorEmail: log.actor?.email ?? null,
      })),
    };
  }

  async approve(id: string, actorUserId: string) {
    const existing = await this.prisma.registrationRequest.findUnique({ where: { id } });
    if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, "No encontramos esa solicitud.");
    if (existing.status === "APPROVED" && existing.userId && existing.businessId) {
      return {
        status: "APPROVED" as const,
        userId: existing.userId,
        businessId: existing.businessId,
        idempotent: true,
      };
    }
    if (existing.status !== "PENDING_ADMIN_APPROVAL") {
      throw new AppError(ERROR_CODES.CONFLICT, "Esa solicitud ya no se puede aprobar.");
    }
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.registrationRequest.updateMany({
        where: { id, status: "PENDING_ADMIN_APPROVAL" },
        data: {
          status: "APPROVED",
          decidedAt: now,
          decidedByUserId: actorUserId,
          emailTokenHash: null,
          emailTokenExpiresAt: null,
        },
      });
      if (claimed.count !== 1) return null;
      const emailTaken = await tx.user.findUnique({ where: { email: existing.email } });
      if (emailTaken) {
        throw new AppError(ERROR_CODES.CONFLICT, "Ese correo ya tiene una cuenta.");
      }
      let created: { userId: string; businessId: string };
      try {
        created = await createOwnerAccount(tx, {
          email: existing.email,
          passwordHash: existing.passwordHash,
          businessName: existing.name,
        });
      } catch (e) {
        const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
        if (code === "P2002") {
          throw new AppError(ERROR_CODES.CONFLICT, "Ese correo ya tiene una cuenta.");
        }
        throw e;
      }
      await tx.registrationRequest.update({
        where: { id },
        data: { userId: created.userId, businessId: created.businessId },
      });
      await tx.registrationDecisionLog.create({
        data: {
          id: randomUUID(),
          requestId: id,
          actorUserId,
          action: "approved",
        },
      });
      const body = approvedMail(existing.name);
      await this.mail.enqueue(tx, {
        dedupeKey: `registration:${id}:approved`,
        kind: "registration_approved",
        to: existing.email,
        ...body,
      });
      return created;
    });
    if (!result) {
      const again = await this.prisma.registrationRequest.findUnique({ where: { id } });
      if (again?.status === "APPROVED" && again.userId && again.businessId) {
        return {
          status: "APPROVED" as const,
          userId: again.userId,
          businessId: again.businessId,
          idempotent: true,
        };
      }
      throw new AppError(ERROR_CODES.CONFLICT, "Esa solicitud ya no se puede aprobar.");
    }
    await this.mail.flushPending();
    return {
      status: "APPROVED" as const,
      userId: result.userId,
      businessId: result.businessId,
      idempotent: false,
    };
  }

  async reject(id: string, actorUserId: string, note?: string) {
    const existing = await this.prisma.registrationRequest.findUnique({ where: { id } });
    if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, "No encontramos esa solicitud.");
    if (existing.status === "REJECTED") {
      return { status: "REJECTED" as const, idempotent: true };
    }
    if (existing.status !== "PENDING_ADMIN_APPROVAL") {
      throw new AppError(ERROR_CODES.CONFLICT, "Esa solicitud ya no se puede rechazar.");
    }
    const decisionNote = note?.trim() || null;
    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.registrationRequest.updateMany({
        where: { id, status: "PENDING_ADMIN_APPROVAL" },
        data: {
          status: "REJECTED",
          decidedAt: now,
          decidedByUserId: actorUserId,
          decisionNote,
          emailTokenHash: null,
        },
      });
      if (updated.count !== 1) return false;
      await tx.registrationDecisionLog.create({
        data: {
          id: randomUUID(),
          requestId: id,
          actorUserId,
          action: "rejected",
          note: decisionNote,
        },
      });
      const body = rejectedMail(existing.name, decisionNote);
      await this.mail.enqueue(tx, {
        dedupeKey: `registration:${id}:rejected`,
        kind: "registration_rejected",
        to: existing.email,
        ...body,
      });
      return true;
    });
    if (!claimed) {
      const again = await this.prisma.registrationRequest.findUnique({ where: { id } });
      if (again?.status === "REJECTED") return { status: "REJECTED" as const, idempotent: true };
      throw new AppError(ERROR_CODES.CONFLICT, "Esa solicitud ya no se puede rechazar.");
    }
    await this.mail.flushPending();
    return { status: "REJECTED" as const, idempotent: false };
  }

  private readonly publicSelect = {
    id: true,
    name: true,
    email: true,
    status: true,
    emailVerifiedAt: true,
    createdAt: true,
    decidedAt: true,
    decisionNote: true,
    userId: true,
    businessId: true,
    expiresAt: true,
    decidedBy: { select: { email: true } },
  } as const;

  private toPublic(row: {
    id: string;
    name: string;
    email: string;
    status: RegistrationStatus;
    emailVerifiedAt: Date | null;
    createdAt: Date;
    decidedAt: Date | null;
    decisionNote: string | null;
    userId: string | null;
    businessId: string | null;
    expiresAt: Date;
    decidedBy: { email: string } | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
      userId: row.userId,
      businessId: row.businessId,
      expiresAt: row.expiresAt,
      decidedByEmail: row.decidedBy?.email ?? null,
    };
  }

  private assertMailReady() {
    if (!this.mail.canSend()) {
      throw new AppError(
        ERROR_CODES.MAIL_UNAVAILABLE,
        "No podemos enviar el correo de verificación en este momento.",
      );
    }
  }

  private async createRequest(name: string, email: string, passwordHash: string) {
    const now = new Date();
    const token = newEmailToken();
    const id = randomUUID();
    const letter = verificationMail(name, token.raw);
    try {
      await this.prisma.registrationRequest.create({
        data: {
          id,
          name,
          email,
          passwordHash,
          status: "PENDING_EMAIL_VERIFICATION",
          emailTokenHash: token.hash,
          emailTokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
          tokenGeneration: 0,
          resendCount: 0,
          lastResendAt: now,
          expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
          logs: {
            create: { id: randomUUID(), action: "submitted" },
          },
        },
      });
    } catch (e) {
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "P2002") {
        const winner = await this.prisma.registrationRequest.findUnique({ where: { email } });
        if (!winner) throw e;
        if (canReplaceRegistrationCredentials(winner)) {
          await this.issueVerification(winner, { name, passwordHash, revive: true });
        }
        return;
      }
      throw e;
    }
    try {
      await this.mail.sendNow({ to: email, ...letter });
    } catch {
      await this.prisma.registrationDecisionLog.deleteMany({ where: { requestId: id } });
      await this.prisma.registrationRequest.delete({ where: { id } }).catch(() => undefined);
      throw new AppError(
        ERROR_CODES.MAIL_UNAVAILABLE,
        "No podemos enviar el correo de verificación en este momento.",
      );
    }
  }

  private async issueVerification(
    row: RegistrationRequest,
    opts: { name?: string; passwordHash?: string; revive?: boolean },
  ) {
    const now = new Date();
    const nextName = opts.name?.trim();
    const changesIdentity =
      (nextName !== undefined && nextName.length > 0 && nextName !== row.name) ||
      opts.passwordHash !== undefined;
    if (changesIdentity && !canReplaceRegistrationCredentials(row, now.getTime())) return;

    const elapsed = row.lastResendAt ? now.getTime() - row.lastResendAt.getTime() : Number.POSITIVE_INFINITY;
    const inWindow = elapsed < RESEND_LOCK_MS;
    const count = inWindow ? row.resendCount : 0;
    const cooling =
      row.status === "PENDING_EMAIL_VERIFICATION" && inWindow && elapsed < RESEND_GAP_MS;
    const locked = inWindow && count >= MAX_RESENDS;
    if (cooling || locked) return;

    const token = newEmailToken();
    const generation = row.tokenGeneration + 1;
    const name = opts.name?.trim() || row.name;
    const letter = verificationMail(name, token.raw);
    const previous = {
      name: row.name,
      passwordHash: row.passwordHash,
      status: row.status,
      emailTokenHash: row.emailTokenHash,
      emailTokenExpiresAt: row.emailTokenExpiresAt,
      tokenGeneration: row.tokenGeneration,
      resendCount: row.resendCount,
      lastResendAt: row.lastResendAt,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      decidedByUserId: row.decidedByUserId,
      decisionNote: row.decisionNote,
      emailVerifiedAt: row.emailVerifiedAt,
    };
    await this.prisma.registrationRequest.update({
      where: { id: row.id },
      data: {
        name,
        passwordHash: opts.passwordHash ?? row.passwordHash,
        status: "PENDING_EMAIL_VERIFICATION",
        emailTokenHash: token.hash,
        emailTokenExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        tokenGeneration: generation,
        resendCount: count + 1,
        lastResendAt: now,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
        ...(opts.revive
          ? { decidedAt: null, decidedByUserId: null, decisionNote: null, emailVerifiedAt: null }
          : {}),
      },
    });
    try {
      await this.mail.sendNow({ to: row.email, ...letter });
    } catch {
      await this.prisma.registrationRequest.update({ where: { id: row.id }, data: previous });
      throw new AppError(
        ERROR_CODES.MAIL_UNAVAILABLE,
        "No podemos enviar el correo de verificación en este momento.",
      );
    }
    await this.prisma.registrationDecisionLog.create({
      data: {
        id: randomUUID(),
        requestId: row.id,
        action: opts.revive ? "resubmitted" : "resent",
      },
    });
  }

  private async expire(row: RegistrationRequest) {
    const updated = await this.prisma.registrationRequest.updateMany({
      where: { id: row.id, status: "PENDING_EMAIL_VERIFICATION" },
      data: { status: "EXPIRED", emailTokenHash: null, emailTokenExpiresAt: null },
    });
    if (updated.count !== 1) return;
    await this.prisma.registrationDecisionLog.create({
      data: { id: randomUUID(), requestId: row.id, action: "expired" },
    });
    const body = expiredMail(row.name);
    await this.mail.enqueue(this.prisma, {
      dedupeKey: `registration:${row.id}:expired:${row.tokenGeneration}`,
      kind: "registration_expired",
      to: row.email,
      ...body,
    });
    await this.mail.flushPending();
  }

  private async enqueueAdmin(tx: Prisma.TransactionClient, row: RegistrationRequest) {
    const to = registrationAdminEmail();
    if (!to) {
      await tx.registrationDecisionLog.create({
        data: {
          id: randomUUID(),
          requestId: row.id,
          action: "admin_notice_skipped",
          note: "REGISTRATION_ADMIN_EMAIL vacío",
        },
      });
      return;
    }
    const body = adminNoticeMail(row.name, row.email);
    await this.mail.enqueue(tx, {
      dedupeKey: `registration:${row.id}:admin`,
      kind: "admin_approval_needed",
      to,
      ...body,
    });
    await tx.registrationRequest.update({
      where: { id: row.id },
      data: { adminNotifiedAt: new Date() },
    });
  }

  private async notifyAlreadyRegistered(email: string) {
    const day = new Date().toISOString().slice(0, 10);
    const body = alreadyRegisteredMail();
    await this.mail.enqueue(this.prisma, {
      dedupeKey: `account-exists:${email}:${day}`,
      kind: "account_exists",
      to: email,
      ...body,
    });
    await this.mail.flushPending();
    const row = await this.prisma.emailOutbox.findUnique({
      where: { dedupeKey: `account-exists:${email}:${day}` },
    });
    if (!row?.sentAt) {
      throw new AppError(
        ERROR_CODES.MAIL_UNAVAILABLE,
        "No podemos enviar el correo de verificación en este momento.",
      );
    }
  }
}
