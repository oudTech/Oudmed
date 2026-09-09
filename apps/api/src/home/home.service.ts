import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { HomeResponseDTO, HomeWidgetDTO } from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const D0 = () => new Prisma.Decimal(0);
const naira = (d: Prisma.Decimal) => '₦' + Number(d).toLocaleString('en-NG', { maximumFractionDigits: 0 });
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

@Injectable()
export class HomeService {
  constructor(private prisma: PrismaService) {}

  async forActor(actor: Actor): Promise<HomeResponseDTO> {
    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);
    const yesterday = new Date(now.getTime() - 24 * 3600_000);

    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const [tenant, me] = await Promise.all([
        tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } }),
        tx.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } }),
      ]);

      const widgets: HomeWidgetDTO[] = [];
      const role = actor.role;
      const isAdmin = role === 'HOSPITAL_ADMIN' || role === 'SUPER_ADMIN';

      // ── clinical roles ──
      if (role === 'DOCTOR' || role === 'NURSE') {
        const mine = role === 'DOCTOR' ? { doctorId: actor.userId } : {};
        const visits = await tx.visit.findMany({
          where: { startsAt: { gte: from, lte: to }, ...mine },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { startsAt: 'asc' },
        });
        const inProgress = visits.filter((v) => v.status === 'IN_PROGRESS').length;
        const results = await tx.clinicalOrder.findMany({
          where: { status: 'RESULTED', resultedAt: { gte: yesterday }, ...(role === 'DOCTOR' ? { orderedById: actor.userId } : {}) },
          include: { patient: { select: { firstName: true, lastName: true } } },
          orderBy: { resultedAt: 'desc' },
          take: 6,
        });

        widgets.push({
          key: 'today', title: role === 'DOCTOR' ? 'Your day' : 'Today', kind: 'stat',
          stats: [
            { label: 'Appointments today', value: String(visits.length) },
            { label: 'In progress', value: String(inProgress), tone: inProgress ? 'warn' : 'default' },
            { label: 'New results', value: String(results.length), tone: results.length ? 'good' : 'default' },
          ],
        });
        widgets.push({
          key: 'schedule', title: 'Schedule today', kind: 'list', href: '/schedule',
          empty: 'No appointments today.',
          items: visits.slice(0, 8).map((v) => ({
            primary: name(v.patient),
            secondary: `${time(v.startsAt)}${v.reason ? ` · ${v.reason}` : ''}`,
            meta: v.status.replace('_', ' ').toLowerCase(),
          })),
        });
        if (results.length) {
          widgets.push({
            key: 'results', title: 'Results in', kind: 'list', href: '/lab',
            items: results.map((o) => ({
              primary: o.name,
              secondary: name(o.patient),
              meta: o.abnormalFlag && o.abnormalFlag !== 'Normal' ? o.abnormalFlag : undefined,
              tone: o.abnormalFlag && o.abnormalFlag !== 'Normal' ? 'bad' : 'default',
            })),
          });
        }
      }

      // ── pharmacy ──
      if (role === 'PHARMACIST' || isAdmin) {
        const [queue, drugs, batches] = await Promise.all([
          tx.prescription.findMany({
            where: { dispenseStatus: { in: ['PENDING', 'PARTIAL'] } },
            include: { patient: { select: { firstName: true, lastName: true } }, _count: { select: { items: true } } },
            orderBy: { prescribedAt: 'asc' },
            take: 8,
          }),
          tx.drug.findMany({ where: { isActive: true }, select: { quantityOnHand: true, reorderLevel: true } }),
          tx.drugBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { lte: new Date(now.getTime() + 60 * 86400_000) } } }),
        ]);
        const low = drugs.filter((d) => d.quantityOnHand > 0 && d.quantityOnHand <= d.reorderLevel).length;
        const out = drugs.filter((d) => d.quantityOnHand <= 0).length;

        if (role === 'PHARMACIST') {
          widgets.push({
            key: 'pharm-stat', title: 'Pharmacy', kind: 'stat',
            stats: [
              { label: 'Dispensing queue', value: String(queue.length), tone: queue.length ? 'warn' : 'default' },
              { label: 'Low stock', value: String(low), tone: low ? 'warn' : 'default' },
              { label: 'Out of stock', value: String(out), tone: out ? 'bad' : 'default' },
              { label: 'Expiring < 60d', value: String(batches), tone: batches ? 'warn' : 'default' },
            ],
          });
          widgets.push({
            key: 'queue', title: 'Dispensing queue', kind: 'list', href: '/pharmacy',
            empty: 'Queue is clear.',
            items: queue.map((r) => ({
              primary: name(r.patient),
              secondary: `${r._count.items} item${r._count.items === 1 ? '' : 's'}`,
              meta: r.dispenseStatus.toLowerCase(),
            })),
          });
        }
      }

      // ── front desk ──
      if (role === 'RECEPTIONIST') {
        const [visits, incomplete, invAgg] = await Promise.all([
          tx.visit.findMany({
            where: { startsAt: { gte: from, lte: to } },
            include: { patient: { select: { firstName: true, lastName: true } } },
            orderBy: { startsAt: 'asc' },
          }),
          tx.patient.count({ where: { registrationStatus: 'INCOMPLETE', isActive: true } }),
          tx.invoice.findMany({
            where: { status: { in: ['UNPAID', 'PARTIAL'] } },
            select: { totalAmount: true, payments: { select: { amount: true, reversedAt: true } } },
          }),
        ]);
        const awaiting = visits.filter((v) => v.status === 'SCHEDULED').length;
        const outstanding = invAgg.reduce((s, i) => {
          const paid = i.payments.filter((p) => !p.reversedAt).reduce((a, p) => a.add(p.amount), D0());
          const bal = i.totalAmount.sub(paid);
          return bal.gt(0) ? s.add(bal) : s;
        }, D0());

        widgets.push({
          key: 'desk', title: 'Front desk', kind: 'stat',
          stats: [
            { label: 'Appointments today', value: String(visits.length) },
            { label: 'Awaiting check-in', value: String(awaiting), tone: awaiting ? 'warn' : 'default' },
            { label: 'Unpaid invoices', value: String(invAgg.length) },
            { label: 'To collect', value: naira(outstanding), tone: outstanding.gt(0) ? 'warn' : 'default' },
          ],
        });
        widgets.push({
          key: 'checkin', title: 'Awaiting check-in', kind: 'list', href: '/schedule',
          empty: 'Everyone is checked in.',
          items: visits.filter((v) => v.status === 'SCHEDULED').slice(0, 8).map((v) => ({
            primary: name(v.patient),
            secondary: time(v.startsAt),
            meta: v.reason ?? undefined,
          })),
        });
        if (incomplete) {
          widgets.push({
            key: 'incomplete', title: 'Incomplete registrations', kind: 'stat', href: '/patients',
            stats: [{ label: 'Patients to finish registering', value: String(incomplete), tone: 'warn' }],
          });
        }
      }

      // ── money ──
      if (role === 'ACCOUNTANT' || isAdmin) {
        const [payToday, invToday, outstandingInv, claims] = await Promise.all([
          tx.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: from, lte: to }, reversedAt: null } }),
          tx.invoice.aggregate({ _sum: { totalAmount: true }, where: { createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } } }),
          tx.invoice.findMany({
            where: { status: { in: ['UNPAID', 'PARTIAL'] } },
            select: { totalAmount: true, payments: { select: { amount: true, reversedAt: true } } },
          }),
          tx.insuranceClaim.findMany({
            where: { status: { in: ['SUBMITTED', 'PART_PAID', 'REJECTED'] } },
            select: { status: true, claimedAmount: true, paidAmount: true, writeOffAmount: true },
          }),
        ]);
        const outstanding = outstandingInv.reduce((s, i) => {
          const paid = i.payments.filter((p) => !p.reversedAt).reduce((a, p) => a.add(p.amount), D0());
          const bal = i.totalAmount.sub(paid);
          return bal.gt(0) ? s.add(bal) : s;
        }, D0());
        const hmoOutstanding = claims
          .filter((c) => c.status !== 'REJECTED')
          .reduce((s, c) => s.add(c.claimedAmount.sub(c.paidAmount).sub(c.writeOffAmount)), D0());
        const rejected = claims.filter((c) => c.status === 'REJECTED').length;

        widgets.push({
          key: 'money', title: 'Money today', kind: 'stat',
          stats: [
            { label: 'Collected today', value: naira(payToday._sum.amount ?? D0()), tone: 'good' },
            { label: 'Billed today', value: naira(invToday._sum.totalAmount ?? D0()) },
            { label: 'Outstanding', value: naira(outstanding), tone: outstanding.gt(0) ? 'warn' : 'default' },
            { label: 'HMO receivables', value: naira(hmoOutstanding.lt(0) ? D0() : hmoOutstanding), tone: hmoOutstanding.gt(0) ? 'warn' : 'default' },
          ],
        });
        if (role === 'ACCOUNTANT' || isAdmin) {
          widgets.push({
            key: 'claims', title: 'Claims', kind: 'stat', href: '/claims',
            stats: [
              { label: 'Submitted, unpaid', value: String(claims.filter((c) => c.status === 'SUBMITTED').length) },
              { label: 'Part paid', value: String(claims.filter((c) => c.status === 'PART_PAID').length), tone: 'warn' },
              { label: 'Rejected', value: String(rejected), tone: rejected ? 'bad' : 'default' },
            ],
          });
        }
      }

      // ── admin overview ──
      if (isAdmin) {
        const [patients, visits, wards, staff] = await Promise.all([
          tx.patient.count({ where: { isActive: true } }),
          tx.visit.findMany({ where: { startsAt: { gte: from, lte: to } }, select: { status: true } }),
          tx.ward.findMany({ where: { isActive: true }, include: { beds: { select: { status: true } } } }),
          tx.user.count({ where: { tenantId: actor.tenantId, isActive: true } }),
        ]);
        const beds = wards.flatMap((w) => w.beds);
        const occupied = beds.filter((b) => b.status === 'OCCUPIED').length;
        const byStatus = (s: string) => visits.filter((v) => v.status === s).length;

        widgets.unshift({
          key: 'census', title: 'Hospital today', kind: 'stat',
          stats: [
            { label: 'Active patients', value: String(patients) },
            { label: 'Appointments today', value: String(visits.length) },
            { label: 'Beds occupied', value: `${occupied} / ${beds.length}`, tone: beds.length && occupied / beds.length > 0.9 ? 'warn' : 'default' },
            { label: 'Active staff', value: String(staff) },
          ],
        });
        widgets.push({
          key: 'appt-split', title: 'Appointments by status', kind: 'split', href: '/schedule',
          stats: [
            { label: 'Scheduled', value: String(byStatus('SCHEDULED')) },
            { label: 'Checked in', value: String(byStatus('CHECKED_IN')) },
            { label: 'In progress', value: String(byStatus('IN_PROGRESS')) },
            { label: 'Completed', value: String(byStatus('COMPLETED')), tone: 'good' },
            { label: 'No-show', value: String(byStatus('NO_SHOW')), tone: byStatus('NO_SHOW') ? 'bad' : 'default' },
          ],
        });
      }

      if (!widgets.length) {
        widgets.push({
          key: 'welcome', title: 'Welcome', kind: 'stat',
          stats: [{ label: 'Your workspace', value: tenant?.name ?? 'OudHealth' }],
        });
      }

      return {
        hospitalName: tenant?.name ?? 'OudHealth',
        greetingName: (me?.fullName ?? '').split(' ')[0] || 'there',
        today: from.toISOString(),
        role,
        widgets,
      };
    });
  }
}
