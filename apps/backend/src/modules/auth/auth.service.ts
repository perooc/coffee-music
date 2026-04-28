import { Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../database/prisma.service";
import { TokenService } from "./token.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    // Always reach the bcrypt comparison to keep response timing uniform
    // between "user not found" and "wrong password". Prevents trivial
    // user-enumeration via timing.
    const dummyHash = "$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123";
    const hash = user?.password_hash ?? dummyHash;
    const ok = await bcrypt.compare(password, hash);

    if (!user || !user.is_active || !ok) {
      throw new UnauthorizedException({
        message: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

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
