import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { TurnstileService } from './turnstile.service';
import { CreateContactInquiryDto } from './dto/create-contact-inquiry.dto';

const TIME_TRAP_MS = 1500;
const MAX_LINKS = 2;
const LINK_PATTERN = /https?:\/\/|www\./gi;

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly email: EmailService,
    private readonly turnstile: TurnstileService,
  ) {}

  /**
   * Defense-in-depth, cheapest/silent checks first so an obvious bot never
   * costs a Turnstile API call. Honeypot / time-trap / content-heuristic
   * failures return a normal success shape without sending anything, so a
   * bot can't learn which check it tripped. Origin and Turnstile failures
   * are real rejections - a legitimate embed on the wrong origin, or a
   * missing/invalid token, is worth surfacing as an actual error.
   */
  async submit(dto: CreateContactInquiryDto, origin: string | undefined, ip: string | undefined): Promise<{ ok: true }> {
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn('Contact form honeypot triggered - silently dropped');
      return { ok: true };
    }

    if (Date.now() - dto.formRenderedAt < TIME_TRAP_MS) {
      this.logger.warn('Contact form submitted faster than a human could - silently dropped');
      return { ok: true };
    }

    const linkCount =
      (dto.message.match(LINK_PATTERN)?.length ?? 0) +
      (dto.firstName.match(LINK_PATTERN)?.length ?? 0) +
      (dto.lastName.match(LINK_PATTERN)?.length ?? 0);
    if (linkCount > MAX_LINKS) {
      this.logger.warn('Contact form message looked like link-spam - silently dropped');
      return { ok: true };
    }

    this.assertOrigin(origin);

    const verified = await this.turnstile.verify(dto.turnstileToken, ip);
    if (!verified) {
      throw new BadRequestException('We could not verify you are human. Please try again.');
    }

    const to = process.env.CONTACT_INQUIRY_TO || 'info@Oudtechnologies.com';
    await this.email.sendContactInquiry(to, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
    });

    return { ok: true };
  }

  private assertOrigin(origin: string | undefined): void {
    const isProd = process.env.NODE_ENV === 'production';
    const allowed = process.env.FRONTEND_URL?.trim();

    if (!origin) {
      if (isProd) throw new ForbiddenException('Missing origin');
      return; // curl/local tooling without an Origin header - allowed outside production
    }

    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ForbiddenException('Invalid origin');
    }

    if (!isProd && (originHost.includes('localhost') || originHost.includes('127.0.0.1'))) {
      return;
    }

    const allowedHost = allowed ? this.safeHost(allowed) : undefined;
    if (!allowedHost || originHost !== allowedHost) {
      throw new ForbiddenException('Origin not allowed');
    }
  }

  private safeHost(url: string): string | undefined {
    try {
      return new URL(url).host;
    } catch {
      return undefined;
    }
  }
}
