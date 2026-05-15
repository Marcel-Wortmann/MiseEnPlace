import { NestFactory } from '@nestjs/core';
import { BadRequestException, Logger, ValidationPipe, ValidationError } from '@nestjs/common';
import { AppModule } from './app.module';

const SENSITIVE_KEYS = /password|passwort|token|secret|authorization|refreshtoken|accesstoken/i;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Validation');

  // Cors-Origin als kommaseparierte Liste in FRONTEND_ORIGIN.
  // Erlaubt Browser-PWA-Origin sowie App-Origin (z.B. capacitor://localhost).
  // In Dev (NODE_ENV !== 'production') alles erlauben.
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: isProd
      ? (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) return cb(null, true);
          if (allowedOrigins.includes(origin)) return cb(null, true);
          return cb(new Error(`Origin nicht erlaubt: ${origin}`), false);
        }
      : true,
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors: ValidationError[]) => {
        const flat = flattenErrors(errors);
        logger.warn(`Validation failed:\n${flat.join('\n')}`);
        return new BadRequestException({ statusCode: 400, message: flat, error: 'Bad Request' });
      },
    }),
  );

  app.setGlobalPrefix('api');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[Rezepte] Backend läuft auf Port ${port}`);
}

/** Maskiert sensible Werte (Passwörter, Tokens) im Log. */
function maskValue(propertyName: string, value: unknown): string {
  if (SENSITIVE_KEYS.test(propertyName)) return '***';
  return JSON.stringify(value);
}

function flattenErrors(errors: ValidationError[], parentPath = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints) {
      for (const c of Object.values(err.constraints)) {
        out.push(`${path}: ${c} (value=${maskValue(err.property, err.value)})`);
      }
    }
    if (err.children && err.children.length > 0) {
      out.push(...flattenErrors(err.children, path));
    }
  }
  return out;
}

bootstrap();
