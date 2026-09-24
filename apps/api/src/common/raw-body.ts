import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';

/**
 * Paystack signs the raw request bytes, so its webhook route needs them
 * captured before Nest's default body-parser JSON-parses (and discards) them.
 * The app must be created with `{ bodyParser: false }` first; this re-applies
 * express.json() with a `verify` callback for that one route, leaving every
 * other route's normal parsed req.body untouched.
 *
 * Exported so both main.ts (the real app) and integration tests (which build
 * their own NestApplication via Test.createTestingModule, bypassing main.ts
 * entirely) apply the exact same behaviour - a webhook signature test is
 * worthless if the app under test never actually captures the raw body.
 */
export function configurePaystackRawBody(app: NestExpressApplication): void {
  app.use(
    json({
      verify: (req: { url?: string; rawBody?: Buffer }, _res, buf) => {
        if (req.url?.startsWith('/api/subscriptions/webhooks/paystack')) req.rawBody = buf;
      },
    }),
  );
}
