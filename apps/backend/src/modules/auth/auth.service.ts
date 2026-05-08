import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { TokenService } from "./token.service";
import { EmailService } from "./email.service";

/**
 * Auth lifecycle for the admin panel:
 *   - login with lockout (5 fails / 20 min)
 *   - email password-reset (single-use, 1h)
 *   - failure notification email to the security inbox
 *
 * Lockout state lives on User (failed_attempts, locked_until). Reset
 * tokens are single-use random strings; we store only their bcrypt
 * hash so a DB dump can't be replayed.
 */
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MINUTES = 20;
const RESET_TOKEN_HOURS = 1;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly email: EmailService,
  ) {}

  async login(email: string, password: string, ip: string | null = null) {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });

    // Always reach bcrypt — uniform timing prevents user enumeration.
    const dummyHash = "$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123";
    const hash = user?.password_hash ?? dummyHash;
    const passwordOk = await bcrypt.compare(password, hash);

    // Locked? Refuse early — but DON'T tell the attacker the lock state
    // explicitly. The error code is the same as a wrong password from
    // the unauthenticated client's perspective.
    if (user && user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException({
        message: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

    if (!user || !user.is_active || !passwordOk) {
      // Bump the counter only if the email was real — otherwise random
      // typos from the attacker would lock legit users out.
      if (user && user.is_active) {
        await this.recordFailedAttempt(user.id, normalized, ip);
      }
      throw new UnauthorizedException({
        message: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

    // Success → wipe the failure trail.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failed_attempts: 0,
        locked_until: null,
        last_failed_at: null,
      },
    });

    const token = this.tokens.signAdmin({
      sub: user.id,
      name: user.name,
      role: user.role,
    });

    return {
      token,
      user: this.serialize(user),
    };
  }

  async findById(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.is_active) {
      throw new UnauthorizedException({
        message: "User no longer active",
        code: "AUTH_USER_INACTIVE",
      });
    }
    return this.serialize(user);
  }

  /**
   * Generates a reset token and emails it. Always returns success even
   * when the email isn't registered — that prevents the endpoint from
   * being used to enumerate which addresses are admins.
   */
  async requestPasswordReset(email: string) {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (user && user.is_active) {
      const raw = randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(raw, 10);
      const expiresAt = new Date(
        Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000,
      );
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          reset_token_hash: tokenHash,
          reset_expires_at: expiresAt,
        },
      });
      const baseUrl =
        process.env.RESET_BASE_URL ?? "http://localhost:3000";
      const url = `${baseUrl.replace(/\/+$/, "")}/admin/reset-password?token=${raw}&email=${encodeURIComponent(normalized)}`;
      await this.email
        .sendPasswordReset(normalized, user.name, url)
        .catch((err) => this.logger.error(`reset email failed: ${err}`));
    }
    // Don't leak whether the user exists.
    return { ok: true };
  }

  async resetPassword(email: string, token: string, newPassword: string) {
    if (typeof newPassword !== "string" || newPassword.length === 0) {
      throw new BadRequestException({
        message: "Password vacío",
        code: "AUTH_PASSWORD_REQUIRED",
      });
    }
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (
      !user ||
      !user.is_active ||
      !user.reset_token_hash ||
      !user.reset_expires_at
    ) {
      throw new BadRequestException({
        message: "Enlace inválido o expirado",
        code: "AUTH_RESET_INVALID",
      });
    }
    if (user.reset_expires_at < new Date()) {
      throw new BadRequestException({
        message: "Enlace inválido o expirado",
        code: "AUTH_RESET_INVALID",
      });
    }
    const ok = await bcrypt.compare(token, user.reset_token_hash);
    if (!ok) {
      throw new BadRequestException({
        message: "Enlace inválido o expirado",
        code: "AUTH_RESET_INVALID",
      });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: passwordHash,
        reset_token_hash: null,
        reset_expires_at: null,
        // Clear the lockout state too — the legitimate owner just
        // proved they control the email, no point forcing them to
        // wait out the cooldown.
        failed_attempts: 0,
        locked_until: null,
        last_failed_at: null,
      },
    });
    return { ok: true };
  }

  private async recordFailedAttempt(
    userId: number,
    email: string,
    ip: string | null,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const now = new Date();
    const nextCount = (user.failed_attempts ?? 0) + 1;
    const willLock = nextCount >= LOGIN_LOCKOUT_THRESHOLD;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failed_attempts: nextCount,
        last_failed_at: now,
        locked_until: willLock
          ? new Date(now.getTime() + LOGIN_LOCKOUT_MINUTES * 60 * 1000)
          : null,
      },
    });
    // Only email when the account actually locks. The owner asked us
    // to drop the per-attempt notifications — five emails on a forgotten
    // password is noise, not signal. Reaching the threshold is the
    // event worth a real alert.
    if (willLock) {
      await this.email
        .sendFailedLoginAlert({
          email,
          failedAttempts: nextCount,
          locked: true,
          ip,
        })
        .catch((err) => this.logger.error(`alert email failed: ${err}`));
    }
  }

  private serialize(user: {
    id: number;
    name: string;
    email: string;
    role: "admin" | "staff";
    is_active: boolean;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
    };
  }
}
