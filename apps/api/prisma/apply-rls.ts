// Applies the RLS policies in rls.sql. Run after `prisma migrate`.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function main() {
  const sql = readFileSync(join(__dirname, 'rls.sql'), 'utf-8');
  await prisma.$executeRawUnsafe(sql);
  console.log('✓ Row-Level Security policies applied');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
