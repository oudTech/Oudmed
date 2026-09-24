/**
 * Creates (or resets the password of) a platform operator account - OudHealth's
 * own team, not a hospital's staff. There is no self-serve sign-up for this;
 * run it directly against the target database.
 *
 *   PLATFORM_USER_EMAIL=you@oudmed.com \
 *   PLATFORM_USER_PASSWORD='a strong password, 12+ chars' \
 *   PLATFORM_USER_NAME='Your Name' \
 *   pnpm create-platform-user
 *
 * Safe to re-run: an existing email just gets its password and name updated.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const email = process.env.PLATFORM_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_USER_PASSWORD;
  const fullName = process.env.PLATFORM_USER_NAME?.trim();

  if (!email || !email.includes('@')) throw new Error('Set PLATFORM_USER_EMAIL to a valid email address');
  if (!password || password.length < 12) throw new Error('Set PLATFORM_USER_PASSWORD (>= 12 chars)');
  if (!fullName) throw new Error('Set PLATFORM_USER_NAME');

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.platformUser.upsert({
      where: { email },
      create: { email, passwordHash, fullName },
      update: { passwordHash, fullName, isActive: true },
    });
    console.log(`Platform user ready: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
