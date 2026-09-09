import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BedStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan } from '../common/permissions';
import { AddBedsDto, CreateWardDto, UpdateBedDto, UpdateWardDto } from './dto/wards.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

/** Bed statuses a human may set directly (OCCUPIED is only reached via admit). */
const SETTABLE_BED_STATUS: BedStatus[] = [
  BedStatus.AVAILABLE,
  BedStatus.RESERVED,
  BedStatus.MAINTENANCE,
];

@Injectable()
export class WardsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** The bed board: every ward, its beds, and who is in each occupied bed. */
  async board(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const wards = await tx.ward.findMany({
        where: { isActive: true },
        include: { beds: { orderBy: { label: 'asc' } } },
        orderBy: { name: 'asc' },
      });
      const admissions = await tx.admission.findMany({
        where: { status: 'ADMITTED', bedId: { not: null } },
        include: {
          patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
          attendingDoctor: { select: { id: true, fullName: true } },
        },
      });
      const byBed = new Map(admissions.map((a) => [a.bedId as string, a]));

      return wards.map((w) => {
        const beds = w.beds.map((b) => {
          const a = byBed.get(b.id);
          return {
            id: b.id,
            label: b.label,
            status: b.status,
            admission: a
              ? {
                  id: a.id,
                  admissionNumber: a.admissionNumber,
                  admissionType: a.admissionType,
                  admittedAt: a.admittedAt,
                  patient: a.patient,
                  attendingDoctor: a.attendingDoctor,
                }
              : null,
          };
        });
        return {
          id: w.id,
          name: w.name,
          wardType: w.wardType,
          beds,
          stats: {
            total: beds.length,
            occupied: beds.filter((b) => b.status === 'OCCUPIED').length,
            available: beds.filter((b) => b.status === 'AVAILABLE').length,
          },
        };
      });
    });
  }

  async createWard(actor: Actor, dto: CreateWardDto) {
    assertCan(actor.role, 'ward:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const exists = await tx.ward.findFirst({ where: { name: dto.name } });
      if (exists) throw new ConflictException('A ward with that name already exists');

      const ward = await tx.ward.create({
        data: { tenantId: actor.tenantId, name: dto.name, wardType: dto.wardType },
      });
      if (dto.bedCount && dto.bedCount > 0) {
        await tx.bed.createMany({
          data: bedRows(actor.tenantId, ward.id, dto.bedPrefix ?? prefixFrom(dto.name), 1, dto.bedCount),
        });
      }
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'CREATE',
        entityType: 'Ward', entityId: ward.id,
      });
      return this.board(actor.tenantId);
    });
  }

  async updateWard(actor: Actor, id: string, dto: UpdateWardDto) {
    assertCan(actor.role, 'ward:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const ward = await tx.ward.findFirst({ where: { id } });
      if (!ward) throw new NotFoundException('Ward not found');
      await tx.ward.update({ where: { id }, data: dto });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
        entityType: 'Ward', entityId: id,
      });
      return this.board(actor.tenantId);
    });
  }

  async addBeds(actor: Actor, wardId: string, dto: AddBedsDto) {
    assertCan(actor.role, 'ward:manage');
    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const ward = await tx.ward.findFirst({ where: { id: wardId }, include: { beds: true } });
      if (!ward) throw new NotFoundException('Ward not found');

      let data: Prisma.BedCreateManyInput[];
      if (dto.labels?.length) {
        const taken = new Set(ward.beds.map((b) => b.label));
        data = dto.labels
          .map((l) => l.trim())
          .filter((l) => l && !taken.has(l))
          .map((label) => ({ tenantId: actor.tenantId, wardId, label }));
      } else {
        const prefix = dto.prefix ?? prefixFrom(ward.name);
        const nextNum =
          Math.max(
            0,
            ...ward.beds
              .map((b) => Number(b.label.replace(/\D/g, '')))
              .filter((n) => !Number.isNaN(n)),
          ) + 1;
        data = bedRows(actor.tenantId, wardId, prefix, nextNum, dto.count ?? 1);
      }
      if (!data.length) throw new BadRequestException('Nothing to add');
      await tx.bed.createMany({ data });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'ADD_BEDS',
        entityType: 'Ward', entityId: wardId, metadata: { count: data.length },
      });
      return this.board(actor.tenantId);
    });
  }

  async updateBed(actor: Actor, wardId: string, bedId: string, dto: UpdateBedDto) {
    if (dto.status && !dto.label) assertCan(actor.role, 'bed:set-status');
    else assertCan(actor.role, 'ward:manage');

    return this.prisma.forTenant(actor.tenantId, async (tx) => {
      const bed = await tx.bed.findFirst({ where: { id: bedId, wardId } });
      if (!bed) throw new NotFoundException('Bed not found');

      if (dto.status && dto.status !== bed.status) {
        if (bed.status === BedStatus.OCCUPIED) {
          throw new ConflictException('Discharge or transfer the patient before changing this bed');
        }
        if (!SETTABLE_BED_STATUS.includes(dto.status)) {
          throw new BadRequestException('That bed status cannot be set directly');
        }
      }
      await tx.bed.update({
        where: { id: bedId },
        data: { label: dto.label ?? undefined, status: dto.status ?? undefined },
      });
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
        entityType: 'Bed', entityId: bedId, metadata: { status: dto.status },
      });
      return this.board(actor.tenantId);
    });
  }
}

function prefixFrom(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
}
function bedRows(
  tenantId: string,
  wardId: string,
  prefix: string,
  start: number,
  count: number,
): Prisma.BedCreateManyInput[] {
  return Array.from({ length: count }, (_, i) => ({
    tenantId,
    wardId,
    label: `${prefix}-${String(start + i).padStart(2, '0')}`,
  }));
}
