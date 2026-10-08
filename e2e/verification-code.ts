import * as fs from 'fs';
import * as path from 'path';

/** apps/api/src/email/email.service.ts logs
 *  `Subject: ${code} is your Oudmed verification code`
 * when RESEND_API_KEY is unset (true in this environment) instead of
 * sending a real email - the sanctioned dev-mode fallback the deployment
 * docs themselves describe. Polls the API's log file (playwright.config.ts
 * redirects its webServer output there) for the newest code sent to a
 * given address, so T1-02/T1-03's sign-up + verification flow can be
 * driven for real without a real inbox. */
const LOG_PATH = path.join(__dirname, '.tmp', 'api.log');

function extractLatestCode(logText: string, to: string): string | null {
  const lines = logText.split('\n');
  let sawToLine = false;
  let latest: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`To: ${to}`)) sawToLine = true;
    if (sawToLine && i + 1 < lines.length) {
      const m = lines[i + 1].match(/Subject:\s*(\d{6}) is your Oudmed verification code/);
      if (m) {
        latest = m[1];
        sawToLine = false;
      }
    }
  }
  return latest;
}

export async function waitForVerificationCode(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(LOG_PATH)) {
      const text = fs.readFileSync(LOG_PATH, 'utf-8');
      const code = extractLatestCode(text, email);
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `No verification code found for ${email} in ${LOG_PATH} within ${timeoutMs}ms - ` +
      `is the API running with RESEND_API_KEY unset, and is its output actually redirected there?`,
  );
}
