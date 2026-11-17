import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import type { MailBody } from "./email-templates";

type OutboxClient = Prisma.TransactionClient | PrismaService;

export type OutgoingMail = MailBody & { to: string };

@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");
  /** Captured messages in dev/test (and also when SMTP is configured, for diagnostics in-process). */
  readonly sent: OutgoingMail[] = [];
  /** Test hook: the next sendNow throws. */
  failNextSend = false;

  constructor(private readonly prisma: PrismaService) {}

  configured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.MAIL_HOST?.trim() && env.MAIL_FROM?.trim());
  }

  /** Production refuses to pretend an email was sent. Tests capture instead. */
  canSend(env: NodeJS.ProcessEnv = process.env): boolean {
    if (this.configured(env)) return true;
    return env.NODE_ENV !== "production";
  }

  async sendNow(message: OutgoingMail, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("smtp_down");
    }
    if (!this.configured(env)) {
      if (env.NODE_ENV === "production") throw new Error("smtp_unconfigured");
      this.sent.push(message);
      return;
    }
    const port = Number(env.MAIL_PORT ?? 587);
    const user = env.MAIL_USER?.trim();
    const pass = env.MAIL_PASSWORD ?? "";
    const transport = nodemailer.createTransport({
      host: env.MAIL_HOST,
      port,
      secure: env.MAIL_SECURE === "true" || port === 465,
      auth: user ? { user, pass } : undefined,
    });
    await transport.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.sent.push({ ...message, text: "[sent]", html: "[sent]" });
  }

  async enqueue(
    db: OutboxClient,
    input: { dedupeKey: string; kind: string; to: string } & MailBody,
  ): Promise<void> {
    try {
      await db.emailOutbox.create({
        data: {
          id: randomUUID(),
          dedupeKey: input.dedupeKey,
          kind: input.kind,
          toAddress: input.to,
          subject: input.subject,
          textBody: input.text,
          htmlBody: input.html,
        },
      });
    } catch (e) {
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
      if (code === "P2002") return;
      throw e;
    }
  }

  /** Delivers unsent non-secret mail. Stops after 5 attempts. Never logs the body. */
  async flushPending(limit = 20): Promise<void> {
    const rows = await this.prisma.emailOutbox.findMany({
      where: { sentAt: null, attempts: { lt: 5 } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    for (const row of rows) {
      try {
        await this.sendNow({
          to: row.toAddress,
          subject: row.subject,
          text: row.textBody,
          html: row.htmlBody,
        });
        await this.prisma.emailOutbox.update({
          where: { id: row.id },
          data: { sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
      } catch {
        await this.prisma.emailOutbox.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastError: "smtp_failed" },
        });
        this.log.warn(`outbox ${row.kind} failed`);
      }
    }
  }
}
