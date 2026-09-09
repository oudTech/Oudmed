import { Injectable, Logger } from '@nestjs/common';
import { connect } from 'net';

export type ScanResult = 'CLEAN' | 'INFECTED' | 'SKIPPED';

/**
 * Malware scan via ClamAV's `clamd` INSTREAM protocol, spoken directly over TCP
 * (no library). Active only when CLAMAV_HOST is set; otherwise every scan is
 * SKIPPED. A scanner error or timeout resolves to SKIPPED (fail-open) with a
 * warning - a health system should not lose the ability to attach a discharge
 * summary because clamd is down; the download-time gate still blocks anything
 * that was recorded INFECTED.
 */
@Injectable()
export class ScanService {
  private readonly log = new Logger(ScanService.name);
  private readonly host = process.env.CLAMAV_HOST;
  private readonly port = Number(process.env.CLAMAV_PORT) || 3310;
  private readonly timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS) || 8000;

  get enabled(): boolean {
    return !!this.host;
  }

  async scan(buffer: Buffer): Promise<ScanResult> {
    if (!this.host) return 'SKIPPED';
    try {
      return await this.instream(buffer);
    } catch (err) {
      this.log.warn(`clamd scan failed (${(err as Error)?.message ?? err}) - recording SKIPPED`);
      return 'SKIPPED';
    }
  }

  private instream(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host!, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;

      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };

      socket.setTimeout(this.timeoutMs);
      socket.on('timeout', () => done(() => reject(new Error('clamd timeout'))));
      socket.on('error', (e) => done(() => reject(e)));
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8');
        if (/\bOK\b/.test(reply) && !/FOUND/.test(reply)) return done(() => resolve('CLEAN'));
        if (/FOUND/.test(reply)) return done(() => resolve('INFECTED'));
        done(() => reject(new Error(`unexpected clamd reply: ${reply.trim()}`)));
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const CHUNK = 64 * 1024;
        for (let off = 0; off < buffer.length; off += CHUNK) {
          const slice = buffer.subarray(off, off + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(slice.length, 0);
          socket.write(len);
          socket.write(slice);
        }
        socket.write(Buffer.from([0, 0, 0, 0])); // zero-length chunk = end of stream
      });
    });
  }
}
