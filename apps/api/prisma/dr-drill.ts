/**
 * Disaster-recovery restore-drill helper. Operates only on `DrillMarker`, a
 * table dedicated to this purpose (see docs/OPERATIONS_GUIDE.md) - it never
 * touches patient, billing, or any other real data, so it's safe to run
 * against a real environment's database directly.
 *
 * Usage:
 *   pnpm dr-drill plant             - create a marker row, prints its id
 *   pnpm dr-drill check <id>        - look up a marker row by id
 *   pnpm dr-drill clear <id>        - delete a marker row (the "data loss" step)
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    if (cmd === 'plant') {
      const label = `DR-DRILL-${new Date().toISOString()}`;
      const row = await prisma.drillMarker.create({ data: { label } });
      console.log(`Planted marker:\n  id:        ${row.id}\n  label:     ${row.label}\n  createdAt: ${row.createdAt.toISOString()}`);
      console.log(`\nRecord this id and the exact time you plan to delete it, then run:\n  pnpm dr-drill clear ${row.id}`);
      return;
    }
    if (cmd === 'check') {
      if (!arg) throw new Error('Usage: pnpm dr-drill check <id>');
      const row = await prisma.drillMarker.findUnique({ where: { id: arg } });
      if (!row) {
        console.log(`NOT FOUND: no DrillMarker with id ${arg} (expected on the pre-restore/live database after "clear"; should reappear on a branch restored to before the clear time)`);
      } else {
        console.log(`FOUND:\n  id:        ${row.id}\n  label:     ${row.label}\n  createdAt: ${row.createdAt.toISOString()}`);
      }
      return;
    }
    if (cmd === 'clear') {
      if (!arg) throw new Error('Usage: pnpm dr-drill clear <id>');
      const now = new Date().toISOString();
      await prisma.drillMarker.delete({ where: { id: arg } });
      console.log(`Cleared marker ${arg} at ${now} (UTC ISO) - this is the "before" timestamp to restore to.`);
      return;
    }
    throw new Error('Usage: pnpm dr-drill <plant|check|clear> [id]');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
