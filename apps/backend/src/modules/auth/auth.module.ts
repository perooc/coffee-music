import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";
import { JwtGuard } from "./guards/jwt.guard";
import { RolesGuard } from "./guards/roles.guard";
import { SessionAccessGuard } from "./guards/session-access.guard";

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "unsafe-dev-secret",
      // Per-token expiry is set at sign time in TokenService.
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtGuard,
    RolesGuard,
    SessionAccessGuard,
  ],
  exports: [AuthService, TokenService, JwtGuard, RolesGuard, SessionAccessGuard],
})
export class AuthModule {}
