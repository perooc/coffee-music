import "dotenv/config";
// Sentry instrumentation. MUST be the first import after dotenv — it
// monkey-patches HTTP / Express modules at load time. Importing later
// means those modules are already constructed and we miss traces.
import "./instrument";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = (
    process.env.FRONTEND_URLS ??
    process.env.FRONTEND_URL ??
    "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown fields silently — was already on.
      whitelist: true,
      // Reject the request entirely if there are unknown fields. This makes
      // forged client payloads (e.g. trying to inject created_by, role, or
      // other privileged fields the DTO does not declare) a 400 instead of a
      // silent strip, so they show up in monitoring.
      forbidNonWhitelisted: true,
      // Transform plain bodies into DTO instances + coerce primitives.
      transform: true,
    }),
  );

  app.setGlobalPrefix("api");

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);

  console.log(`Backend running on http://localhost:${port}/api`);
}

void bootstrap();
