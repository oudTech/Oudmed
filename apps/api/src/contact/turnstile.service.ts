import { Injectable, Logger } from '@nestjs/common';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verifies a Cloudflare Turnstile token server-side. Note the domain is
 * "challenges" (plural) - the singular "challenge.cloudflare.com" does not
 * resolve and fails silently, which is a real trap when copying this URL.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      // No secret configured (e.g. local dev without a Cloudflare widget set up yet) -
      // fail closed rather than silently accepting every submission.
      this.logger.warn('TURNSTILE_SECRET_KEY is not set - rejecting all contact submissions');
      return false;
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = (await res.json()) as SiteverifyResponse;
      if (!data.success) {
        this.logger.warn(`Turnstile verification failed: ${(data['error-codes'] ?? []).join(', ')}`);
      }
      return data.success === true;
    } catch (err) {
      this.logger.error('Turnstile verification request failed', err as Error);
      return false;
    }
  }
}
