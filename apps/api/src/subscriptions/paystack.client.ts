import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

const BASE_URL = 'https://api.paystack.co';

interface InitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

interface ChargeResult {
  status: string;
  reference: string;
  authorizationCode: string | null;
  reusable: boolean;
}

/**
 * Thin wrapper over Paystack's REST API - no SDK dependency, Paystack's HTTP
 * surface is small and well documented. PAYSTACK_SECRET_KEY /
 * PAYSTACK_WEBHOOK_SECRET are unset until a real (test or live) Paystack
 * account is wired in; every method fails clearly rather than silently
 * no-op'ing, since "payment didn't happen" must never look like success.
 */
@Injectable()
export class PaystackClient {
  private get secretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Card payments are not configured yet. Pay by bank transfer instead, or contact support.',
        code: 'PAYSTACK_NOT_CONFIGURED',
      });
    }
    return key;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!res.ok || !body?.status) {
      throw new InternalServerErrorException({
        statusCode: 500,
        message: body?.message ?? 'Paystack request failed',
        code: 'PAYSTACK_ERROR',
      });
    }
    return body.data as T;
  }

  /** amountNaira is whole naira; Paystack expects the smallest unit (kobo). */
  async initializeTransaction(opts: {
    email: string;
    amountNaira: number;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<InitializeResult> {
    const data = await this.request<{ authorization_url: string; access_code: string; reference: string }>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: JSON.stringify({
          email: opts.email,
          amount: Math.round(opts.amountNaira * 100),
          currency: 'NGN',
          reference: opts.reference,
          callback_url: opts.callbackUrl,
          metadata: opts.metadata,
        }),
      },
    );
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
  }

  async verifyTransaction(reference: string): Promise<ChargeResult & { amountNaira: number }> {
    const data = await this.request<{
      status: string;
      amount: number;
      reference: string;
      authorization?: { authorization_code: string; reusable: boolean };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    return {
      status: data.status,
      amountNaira: data.amount / 100,
      reference: data.reference,
      authorizationCode: data.authorization?.reusable ? data.authorization.authorization_code : null,
      reusable: !!data.authorization?.reusable,
    };
  }

  /**
   * Re-charges a previously-authorized card - this is how a renewal happens
   * without the hospital re-entering card details, and deliberately does not
   * use Paystack's own Subscriptions/Plan API: our price is recomputed per
   * seat count at charge time, not a fixed plan amount.
   */
  async chargeAuthorization(opts: {
    email: string;
    amountNaira: number;
    authorizationCode: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChargeResult> {
    const data = await this.request<{
      status: string;
      reference: string;
      authorization?: { authorization_code: string; reusable: boolean };
    }>('/transaction/charge_authorization', {
      method: 'POST',
      body: JSON.stringify({
        email: opts.email,
        amount: Math.round(opts.amountNaira * 100),
        authorization_code: opts.authorizationCode,
        reference: opts.reference,
        metadata: opts.metadata,
      }),
    });
    return {
      status: data.status,
      reference: data.reference,
      authorizationCode: data.authorization?.reusable ? data.authorization.authorization_code : null,
      reusable: !!data.authorization?.reusable,
    };
  }

  /**
   * Paystack signs the raw request body with the secret key (HMAC-SHA512).
   * `timingSafeEqual` avoids leaking a timing side-channel on the comparison;
   * both buffers must be equal length first or it throws instead of comparing.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret || !signatureHeader) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHeader, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
