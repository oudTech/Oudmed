import { Injectable } from '@nestjs/common';
import { Prisma, VisitStatus } from '@prisma/client';
import type {
  ReportGranularity,
  ReportKpiDTO,
  ReportsOverviewDTO,
  ReportPaymentsResponse,
} from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { assertCan } from '../common/permissions';
import {
  ageFrom,
  autoUnit,
  buildBuckets,
  deltaPct,
  fillBuckets,
  PAYER_LABEL,
  resolveRange,
  trendWindow,
} from './reports.util';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PAGE_SIZE = 25;
const D0 = () => new Prisma.Decimal(0);
const num = (d: Prisma.Decimal | null | undefined) => Number(d ?? 0);

type OverviewQuery = {
  preset?: string;
  from?: string;
  to?: string;
  granularity?: ReportGranularity;
};

type PaymentsQuery = {
  preset?: string;
  from?: string;
  to?: string;
  departmentId?: string;
  doctorId?: string;
  page?: number;
};

const CHECKED_IN: VisitStatus[] = [VisitStatus.CHECKED_IN, VisitStatus.IN_PROGRESS];
const MISSED: VisitStatus[] = [VisitStatus.NO_SHOW, VisitStatus.CANCELLED];

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async overview(actor: Actor, q: OverviewQuery): Promise<ReportsOverviewDTO> {
    assertCan(actor.role, 'reports:view');
    const { from, to, label } = resolveRange(q.preset, q.from, q.to);
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = from;
    const granularity: ReportGranularity = q.granularity ?? 'monthly';
    const trend = trendWindow(granularity);
    const now = new Date();

    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const inWindow = { gte: from, lt: to };
      const prevWindow = { gte: prevFrom, lt: prevTo };

      const [
        payments,
        invoices,
        prevInvoices,
        lineAgg,
        visitCount,
        prevVisitCount,
        newPatients,
        prevNewPatients,
        totalPatients,
        totalStaff,
        deptCount,
        shiftsToday,
        activeDoctors,
        prevActiveDoctors,
        statusGroups,
        mixPatients,
        prevMixPatients,
        returningNow,
        returningPrev,
        trendPatients,
        weekdayVisits,
      ] = await Promise.all([
        tx.payment.findMany({
          where: { paidAt: inWindow, reversedAt: null },
          select: { amount: true, payerType: true, paidAt: true },
        }),
        tx.invoice.findMany({
          where: { createdAt: inWindow, status: { not: 'CANCELLED' } },
          select: {
            totalAmount: true,
            subtotal: true,
            visit: { select: { departmentId: true, doctorId: true } },
          },
        }),
        tx.invoice.aggregate({
          _sum: { totalAmount: true },
          where: { createdAt: prevWindow, status: { not: 'CANCELLED' } },
        }),
        tx.invoiceLine.aggregate({
          _sum: { grossAmount: true, lineTotal: true },
          where: { invoice: { createdAt: inWindow, status: { not: 'CANCELLED' } } },
        }),
        tx.visit.count({ where: { startsAt: inWindow } }),
        tx.visit.count({ where: { startsAt: prevWindow } }),
        tx.patient.count({ where: { createdAt: inWindow } }),
        tx.patient.count({ where: { createdAt: prevWindow } }),
        tx.patient.count({ where: { isActive: true } }),
        tx.user.count({ where: { tenantId: actor.tenantId, isActive: true } }),
        tx.department.count({ where: { isActive: true } }),
        tx.doctorShift.findMany({
          where: { tenantId: actor.tenantId, dayOfWeek: now.getDay() },
          select: { doctorId: true },
          distinct: ['doctorId'],
        }),
        tx.visit.findMany({
          where: { startsAt: inWindow, doctorId: { not: null } },
          select: { doctorId: true },
          distinct: ['doctorId'],
        }),
        tx.visit.findMany({
          where: { startsAt: prevWindow, doctorId: { not: null } },
          select: { doctorId: true },
          distinct: ['doctorId'],
        }),
        tx.visit.groupBy({
          by: ['status'],
          where: { startsAt: inWindow },
          _count: { _all: true },
        }),
        tx.patient.findMany({
          where: { createdAt: inWindow },
          select: { dateOfBirth: true, gender: true },
        }),
        tx.patient.findMany({
          where: { createdAt: prevWindow },
          select: { dateOfBirth: true, gender: true },
        }),
        tx.patient.count({
          where: { createdAt: { lt: from }, visits: { some: { startsAt: inWindow } } },
        }),
        tx.patient.count({
          where: { createdAt: { lt: prevFrom }, visits: { some: { startsAt: prevWindow } } },
        }),
        tx.patient.findMany({
          where: { createdAt: { gte: trend.from } },
          select: { createdAt: true },
        }),
        tx.visit.findMany({
          where: { startsAt: inWindow },
          select: { startsAt: true, status: true },
        }),
      ]);

      // ── names for the breakdown charts ──
      const deptIds = [...new Set(invoices.map((i) => i.visit?.departmentId).filter((x): x is string => !!x))];
      const doctorIds = [...new Set(invoices.map((i) => i.visit?.doctorId).filter((x): x is string => !!x))];
      const [depts, doctors] = await Promise.all([
        deptIds.length
          ? tx.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
          : Promise.resolve([]),
        doctorIds.length
          ? tx.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, fullName: true } })
          : Promise.resolve([]),
      ]);
      const deptName = new Map(depts.map((d) => [d.id, d.name]));
      const doctorName = new Map(doctors.map((d) => [d.id, d.fullName]));

      // ── finance ──
      const totalCollection = payments.reduce((s, p) => s.add(p.amount), D0());
      const insuranceCollected = payments
        .filter((p) => p.payerType !== 'CASH')
        .reduce((s, p) => s.add(p.amount), D0());
      const revenueBilled = invoices.reduce((s, i) => s.add(i.totalAmount), D0());
      const lineDiscount = num(lineAgg._sum.grossAmount) - num(lineAgg._sum.lineTotal);
      const invoiceDiscount = invoices.reduce((s, i) => s + (num(i.subtotal) - num(i.totalAmount)), 0);
      const totalDiscount = Math.max(0, lineDiscount + invoiceDiscount);

      const finance: ReportKpiDTO[] = [
        kpi('total_collection', 'Total Collection', totalCollection.toString(), 'currency', null, 'N/A vs previous period'),
        kpi('invoice_count', 'Invoice count', String(invoices.length), 'number', null, 'N/A vs previous period'),
        kpi('insurance_collected', 'Insurance Collected', insuranceCollected.toString(), 'currency', null, 'N/A vs previous period'),
        kpi('total_discount', 'Total Discount', String(totalDiscount), 'currency', null, 'N/A vs previous period'),
      ];

      // ── operations ──
      const counts: Partial<Record<VisitStatus, number>> = {};
      for (const g of statusGroups) counts[g.status] = g._count._all;
      const attended = counts[VisitStatus.COMPLETED] ?? 0;
      const missedTotal = (counts[VisitStatus.NO_SHOW] ?? 0) + (counts[VisitStatus.CANCELLED] ?? 0);
      const attendanceRate = attended + missedTotal > 0 ? Math.round((attended / (attended + missedTotal)) * 100) : 0;

      const operations: ReportKpiDTO[] = [
        kpi('total_patients', 'Total Patients', String(totalPatients), 'number', deltaPct(newPatients, prevNewPatients)),
        kpi('total_appointments', 'Total Appointments', String(visitCount), 'number', deltaPct(visitCount, prevVisitCount)),
        kpi('total_revenue', 'Total Revenue', revenueBilled.toString(), 'currency', deltaPct(num(revenueBilled), num(prevInvoices._sum.totalAmount))),
        kpi('active_doctors', 'Active Doctors', String(activeDoctors.length), 'number', deltaPct(activeDoctors.length, prevActiveDoctors.length)),
        kpi('total_staff', 'Total Staff', String(totalStaff), 'number', null),
        kpi('on_duty', 'On duty', String(shiftsToday.length), 'number', null, 'scheduled today'),
        kpi('departments', 'Departments', String(deptCount), 'number', null),
        kpi('attendance_rate', 'Attendance Rate', String(attendanceRate), 'percent', null, 'completed vs missed'),
      ];

      // ── collections over time ──
      const colBuckets = buildBuckets(from, to, autoUnit(from, to));
      const collections = fillBuckets(payments, colBuckets, (p) => p.paidAt, (p) => num(p.amount));

      // ── revenue breakdowns ──
      const revenueByDepartment = groupRevenue(invoices, (i) => i.visit?.departmentId ?? null, deptName);
      const revenueByDoctor = groupRevenue(invoices, (i) => i.visit?.doctorId ?? null, doctorName);

      // ── patient trend ──
      const trendBuckets = buildBuckets(trend.from, now, trend.unit);
      const patientTrend = fillBuckets(trendPatients, trendBuckets, (p) => p.createdAt, () => 1);

      // ── patient mix ──
      const mixNow = tallyMix(mixPatients, now);
      const mixPrev = tallyMix(prevMixPatients, now);
      const patientMix: ReportKpiDTO[] = [
        kpi('new_patients', 'New Patients', String(newPatients), 'number', deltaPct(newPatients, prevNewPatients)),
        kpi('returning_patients', 'Returning Patients', String(returningNow), 'number', deltaPct(returningNow, returningPrev)),
        kpi('age_0_17', 'Age 0 to 17', String(mixNow.age0), 'number', deltaPct(mixNow.age0, mixPrev.age0)),
        kpi('age_18_40', 'Age 18 to 40', String(mixNow.age1), 'number', deltaPct(mixNow.age1, mixPrev.age1)),
        kpi('age_41_60', 'Age 41 to 60', String(mixNow.age2), 'number', deltaPct(mixNow.age2, mixPrev.age2)),
        kpi('age_61_plus', 'Age 61+', String(mixNow.age3), 'number', deltaPct(mixNow.age3, mixPrev.age3)),
        kpi('male', 'Male', String(mixNow.male), 'number', deltaPct(mixNow.male, mixPrev.male)),
        kpi('female', 'Female', String(mixNow.female), 'number', deltaPct(mixNow.female, mixPrev.female)),
      ];

      // ── appointments by weekday ──
      const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const week = order.map((weekday) => ({ weekday, completed: 0, scheduled: 0, checkedIn: 0, missed: 0 }));
      for (const v of weekdayVisits) {
        const idx = (v.startsAt.getDay() + 6) % 7;
        const row = week[idx];
        if (v.status === VisitStatus.COMPLETED) row.completed++;
        else if (v.status === VisitStatus.SCHEDULED) row.scheduled++;
        else if (CHECKED_IN.includes(v.status)) row.checkedIn++;
        else if (MISSED.includes(v.status)) row.missed++;
      }

      return {
        range: { from: from.toISOString(), to: to.toISOString(), label, comparedTo: prevFrom.toISOString() },
        finance,
        operations,
        collections,
        collectionsUnit: 'NGN',
        revenueByDepartment,
        revenueByDoctor,
        patientTrend,
        patientTrendGranularity: granularity,
        patientMix,
        appointmentsByWeekday: week,
      };
    });
  }

  async payments(actor: Actor, q: PaymentsQuery): Promise<ReportPaymentsResponse> {
    assertCan(actor.role, 'reports:view');
    const { from, to } = resolveRange(q.preset, q.from, q.to);
    const page = q.page && q.page > 0 ? q.page : 1;

    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const where: Prisma.PaymentWhereInput = { paidAt: { gte: from, lt: to } };
      if (q.departmentId) where.invoice = { visit: { departmentId: q.departmentId } };
      else if (q.doctorId) where.invoice = { visit: { doctorId: q.doctorId } };

      const [total, sumAgg, rows] = await Promise.all([
        tx.payment.count({ where }),
        tx.payment.aggregate({ _sum: { amount: true }, where: { ...where, reversedAt: null } }),
        tx.payment.findMany({
          where,
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                patient: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { paidAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const cashierIds = [...new Set(rows.map((r) => r.receivedById).filter((x): x is string => !!x))];
      const cashiers = cashierIds.length
        ? await tx.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, fullName: true } })
        : [];
      const cashierName = new Map(cashiers.map((c) => [c.id, c.fullName]));

      return {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalAmount: (sumAgg._sum.amount ?? D0()).toString(),
        rows: rows.map((p) => ({
          id: p.id,
          paidAt: p.paidAt.toISOString(),
          invoiceId: p.invoice?.id ?? '',
          invoiceNumber: p.invoice?.invoiceNumber ?? '-',
          patientName: p.invoice?.patient
            ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}`.trim()
            : '-',
          amount: p.amount.toString(),
          method: p.method,
          paidBy: p.payerName || PAYER_LABEL[p.payerType] || p.payerType,
          cashier: p.receivedById ? cashierName.get(p.receivedById) ?? null : null,
          comment: p.note ?? null,
          status: p.reversedAt ? 'Reversed' : 'Success',
          reversedAt: p.reversedAt ? p.reversedAt.toISOString() : null,
        })),
      };
    });
  }

  async paymentsCsv(actor: Actor, q: PaymentsQuery): Promise<string> {
    assertCan(actor.role, 'reports:view');
    const rows: string[][] = [
      ['Date', 'Invoice', 'Patient', 'Amount', 'Method', 'Paid by', 'Cashier', 'Comment', 'Status', 'Reversed at'],
    ];
    let page = 1;
    for (;;) {
      const res = await this.payments(actor, { ...q, page });
      for (const r of res.rows) {
        rows.push([
          new Date(r.paidAt).toISOString().slice(0, 10),
          r.invoiceNumber,
          r.patientName,
          r.amount,
          r.method,
          r.paidBy,
          r.cashier ?? '',
          r.comment ?? '',
          r.status,
          r.reversedAt ? new Date(r.reversedAt).toISOString().slice(0, 10) : '',
        ]);
      }
      if (page * res.pageSize >= res.total || page >= 200) break;
      page++;
    }
    return rows
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
  }
}

function kpi(
  key: string,
  label: string,
  value: string,
  format: ReportKpiDTO['format'],
  delta: number | null,
  hint?: string,
): ReportKpiDTO {
  return { key, label, value, format, deltaPct: delta, hint };
}

function groupRevenue<T extends { totalAmount: Prisma.Decimal }>(
  rows: T[],
  keyOf: (row: T) => string | null,
  names: Map<string, string>,
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const k = keyOf(row) ?? '__none__';
    totals.set(k, (totals.get(k) ?? 0) + Number(row.totalAmount));
  }
  return [...totals.entries()]
    .map(([id, value]) => ({
      id: id === '__none__' ? null : id,
      label: id === '__none__' ? 'Unassigned' : names.get(id) ?? 'Unknown',
      value,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function tallyMix(
  patients: { dateOfBirth: Date | null; gender: string | null }[],
  at: Date,
) {
  const t = { age0: 0, age1: 0, age2: 0, age3: 0, male: 0, female: 0 };
  for (const p of patients) {
    const age = ageFrom(p.dateOfBirth, at);
    if (age != null) {
      if (age <= 17) t.age0++;
      else if (age <= 40) t.age1++;
      else if (age <= 60) t.age2++;
      else t.age3++;
    }
    const g = (p.gender ?? '').trim().toLowerCase();
    if (g.startsWith('m')) t.male++;
    else if (g.startsWith('f')) t.female++;
  }
  return t;
}
