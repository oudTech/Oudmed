import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { rootDomain } from './common/urls';
import { validateEnv } from './common/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { initSentry } from './common/sentry';
import { configurePaystackRawBody } from './common/raw-body';

async function bootstrap() {
  validateEnv();
  initSentry(); // no-op unless SENTRY_DSN is set

  // bodyParser: false + configurePaystackRawBody together capture the raw
  // bytes Paystack's webhook signature is computed over, which Nest's default
  // body-parser would otherwise discard. See that function's own comment.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configurePaystackRawBody(app);

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.useGlobalFilters(new AllExceptionsFilter());

  // Allow the apex domain and any tenant subdomain of it.
  const root = rootDomain().replace(/:\d+$/, '');
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        const ok = host === root || host === `www.${root}` || host.endsWith(`.${root}`);
        cb(null, ok);
      } catch {
        cb(null, false);
      }
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // The Swagger UI documents every route and its schema. It is on by default in
  // non-production; in production it stays off unless ENABLE_SWAGGER=true is set
  // explicitly (behind an authenticated gateway, for example).
  const swaggerOn =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';
  if (swaggerOn) {
    const config = new DocumentBuilder()
      .setTitle('OudHealth HMS API')
      .setDescription('Multi-tenant Hospital Management System')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(
    `OudHealth API on http://localhost:${port}${swaggerOn ? '  (docs at /docs)' : ''}`,
  );
}
bootstrap();
