import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { apexUrl } from '../common/urls';

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * Transactional email. Uses Resend when RESEND_API_KEY is set; otherwise logs
 * the message to the console so local development works without a provider.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    this.from = process.env.EMAIL_FROM ?? 'Oudmed <onboarding@resend.dev>';
  }

  private async send({ to, subject, html, text, replyTo }: SendArgs): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `[email:dev] To: ${to}${replyTo ? ` (reply-to: ${replyTo})` : ''}\nSubject: ${subject}\n${text}`,
      );
      return;
    }
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html, text, ...(replyTo ? { replyTo } : {}) });
    } catch (err) {
      this.logger.error(`Failed to send "${subject}" to ${to}`, err as Error);
      throw err;
    }
  }

  async sendVerificationCode(to: string, fullName: string, code: string): Promise<void> {
    const firstName = fullName.split(' ')[0] || 'there';
    await this.send({
      to,
      subject: `${code} is your Oudmed verification code`,
      text: `Hi ${firstName},\n\nYour Oudmed verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      html: layout(`
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Use this code to confirm your email address. It expires in 10 minutes.</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0;color:#111827">${code}</p>
        <p style="color:#6b7280;font-size:13px">If you didn't create an Oudmed account, you can safely ignore this email.</p>
      `),
    });
  }

  async sendPasswordReset(to: string, fullName: string, link: string): Promise<void> {
    const firstName = fullName.split(' ')[0] || 'there';
    await this.send({
      to,
      subject: 'Reset your Oudmed password',
      text: `Hi ${firstName},\n\nReset your password using this link (valid for 1 hour):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
      html: layout(`
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Click below to choose a new password. This link is valid for 1 hour.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#3366E3;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a>
        </p>
        <p style="color:#6b7280;font-size:13px">If you didn't request a password reset, you can safely ignore this email.</p>
      `),
    });
  }

  async sendPaymentReceived(to: string, hospitalName: string, amountNaira: string, billingUrl: string): Promise<void> {
    await this.send({
      to,
      subject: `Payment received - ${hospitalName}`,
      text: `Hi,\n\nWe've received your payment of NGN ${amountNaira}. Your Oudmed subscription is active.\n\nView your billing details: ${billingUrl}`,
      html: layout(`
        <p>Hi,</p>
        <p>We've received your payment of <strong>NGN ${escapeHtml(amountNaira)}</strong> for ${escapeHtml(hospitalName)}. Your Oudmed subscription is active.</p>
        <p style="margin:24px 0">
          <a href="${billingUrl}" style="background:#3366E3;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View billing</a>
        </p>
      `),
    });
  }

  async sendPaymentFailed(to: string, hospitalName: string, attempt: number, nextRetryDate: string, billingUrl: string): Promise<void> {
    await this.send({
      to,
      subject: `Payment failed - ${hospitalName}`,
      text: `Hi,\n\nWe couldn't renew your Oudmed subscription - the card on file was declined (attempt ${attempt}). We'll try again on ${nextRetryDate}. Update your payment method to avoid interruption: ${billingUrl}`,
      html: layout(`
        <p>Hi,</p>
        <p>We couldn't renew ${escapeHtml(hospitalName)}'s Oudmed subscription - the card on file was declined (attempt ${attempt}).</p>
        <p>We'll try again on <strong>${escapeHtml(nextRetryDate)}</strong>, or you can update your payment method now.</p>
        <p style="margin:24px 0">
          <a href="${billingUrl}" style="background:#3366E3;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Update payment method</a>
        </p>
      `),
    });
  }

  async sendTrialEndingSoon(to: string, hospitalName: string, daysLeft: number, billingUrl: string): Promise<void> {
    await this.send({
      to,
      subject: `Your Oudmed trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      text: `Hi,\n\n${hospitalName}'s Oudmed trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Add a payment method to keep working without interruption: ${billingUrl}`,
      html: layout(`
        <p>Hi,</p>
        <p>${escapeHtml(hospitalName)}'s Oudmed trial ends in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>. Add a payment method to keep working without interruption.</p>
        <p style="margin:24px 0">
          <a href="${billingUrl}" style="background:#3366E3;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Set up billing</a>
        </p>
      `),
    });
  }

  async sendContactInquiry(
    to: string,
    data: { firstName: string; lastName: string; email: string; phone: string; message: string },
  ): Promise<void> {
    const fullName = `${data.firstName} ${data.lastName}`.trim();
    await this.send({
      to,
      // The submitter's address is set as reply-to, never as a send target -
      // this endpoint only ever sends to the fixed internal inbox above, so
      // it can't be used to relay unsolicited email to a third party.
      replyTo: data.email,
      subject: `New contact inquiry from ${fullName}`,
      text: `${fullName}\nEmail: ${data.email}\nPhone: ${data.phone}\n\n${data.message}`,
      html: layout(`
        <p><strong>${escapeHtml(fullName)}</strong></p>
        <p>Email: ${escapeHtml(data.email)}<br/>Phone: ${escapeHtml(data.phone)}</p>
        <p style="white-space:pre-wrap">${escapeHtml(data.message)}</p>
      `),
    });
  }

  async sendReadOnlyNotice(to: string, hospitalName: string, billingUrl: string): Promise<void> {
    await this.send({
      to,
      subject: `Action needed - ${hospitalName}'s Oudmed subscription`,
      text: `Hi,\n\n${hospitalName}'s Oudmed subscription needs attention. Existing records remain visible, but new patients, appointments and other records cannot be created until billing is updated: ${billingUrl}`,
      html: layout(`
        <p>Hi,</p>
        <p>${escapeHtml(hospitalName)}'s Oudmed subscription needs attention. Existing records remain visible, but new patients, appointments and other records cannot be created until billing is updated.</p>
        <p style="margin:24px 0">
          <a href="${billingUrl}" style="background:#3366E3;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Update billing</a>
        </p>
      `),
    });
  }
}

function layout(inner: string): string {
  const year = new Date().getFullYear();
  const logoUrl = `${apexUrl()}/oudmed-logo-email.png`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F8;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #EEF0F3">
          <tr><td style="padding:32px 32px 24px">
            <img src="${logoUrl}" alt="Oudmed" height="26" style="display:block;height:26px;width:auto;border:0" />
          </td></tr>
          <tr><td style="padding:0 32px 32px;color:#1F2937;font-size:15px;line-height:1.6">
            ${inner}
          </td></tr>
          <tr><td style="padding:20px 32px;border-top:1px solid #EEF0F3;background:#FAFBFC;border-radius:0 0 16px 16px">
            <p style="margin:0 0 4px;font-size:13px;color:#6B7280">Questions? Reach us at <a href="mailto:help@oudmed.com" style="color:#3366E3;text-decoration:none">help@oudmed.com</a></p>
            <p style="margin:0;font-size:12px;color:#9CA3AF">&copy; ${year} Oudmed. All rights reserved.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
