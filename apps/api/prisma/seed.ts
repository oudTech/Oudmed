import {
  PrismaClient,
  Role,
  Plan,
  FacilityType,
  WardType,
  BedStatus,
  VisitType,
  VisitStatus,
  AdmissionType,
  PayerType,
  InsuranceKind,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function at(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
function plusMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

async function main() {
  const passwordHash = await bcrypt.hash('Admin1234!', 12);
  const staffHash = await bcrypt.hash('Password1', 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: { name: 'Demo Hospital' },
    create: {
      name: 'Demo Hospital',
      slug: 'demo',
      facilityType: FacilityType.HOSPITAL,
      country: 'NG',
      plan: Plan.GROWTH,
      primaryColor: '#2563EB',
      contactEmail: 'admin@demo.com',
    },
  });
  const t = tenant.id;

  const upsertUser = (
    email: string,
    fullName: string,
    role: Role,
    jobTitle?: string,
    hash = staffHash,
    opts: { phone?: string; notes?: string; isActive?: boolean } = {},
  ) => {
    const base = {
      fullName, role, jobTitle,
      phone: opts.phone, notes: opts.notes,
      isActive: opts.isActive ?? true,
      emailVerifiedAt: new Date(),
    };
    return prisma.user.upsert({
      where: { tenantId_email: { tenantId: t, email } },
      update: base,
      create: { tenantId: t, email, passwordHash: hash, ...base },
    });
  };

  await prisma.userDepartment.deleteMany({ where: { tenantId: t } });

  await upsertUser('admin@demo.com', 'Demo Admin', Role.HOSPITAL_ADMIN, 'Administrator', passwordHash, {
    phone: '08030000001', notes: 'Head of hospital operations.',
  });
  await upsertUser('reception@demo.com', 'Blessing Okoro', Role.RECEPTIONIST, 'Front Desk', staffHash, { phone: '08030000002' });
  await upsertUser('nurse@demo.com', 'Ngozi Bassey', Role.NURSE, 'Staff Nurse', staffHash, { phone: '08030000003' });
  const pharmacist = await upsertUser('pharmacy@demo.com', 'Tunde Adewale', Role.PHARMACIST, 'Pharmacist', staffHash, { phone: '08030000004' });
  const labStaff = await upsertUser('lab@demo.com', 'Chidi Okafor', Role.LAB_STAFF, 'Laboratory Scientist', staffHash, { phone: '08030000005' });
  const accountant = await upsertUser('accounts@demo.com', 'Musa Bello', Role.ACCOUNTANT, 'Accounts Officer', staffHash, { phone: '08030000006' });
  await upsertUser('grace@demo.com', 'Grace Effiong', Role.NURSE, 'Staff Nurse', staffHash, {
    phone: '08030000007', notes: 'On extended leave.', isActive: false,
  });

  // ── Departments ──
  const deptDefs = [
    ['General Medicine', 'GEN', '08031000010', 'Outpatient general practice clinic.'],
    ['Surgery', 'SUR', '08031000011', 'General and day-case surgery.'],
    ['Paediatrics', 'PAED', '08031000012', 'Children under 16 years.'],
    ['Obstetrics & Gynaecology', 'O&G', '08031000013', 'Antenatal, delivery and gynaecology.'],
    ['Dental', 'DEN', '08031000014', 'Dental and oral health.'],
    ['Emergency', 'ED', '08031000015', 'Round the clock emergency and triage.'],
  ];
  const depts: Record<string, string> = {};
  for (const [name, code, phone, notes] of deptDefs) {
    const d = await prisma.department.upsert({
      where: { tenantId_name: { tenantId: t, name } },
      update: { code, phone, notes },
      create: { tenantId: t, name, code, phone, notes },
    });
    depts[code] = d.id;
  }

  // ── Doctors (match the Figma board) ──
  const doctorDefs = [
    ['j.jumbo@demo.com', 'Dr. John Jumbo', 'Dentist', 'DEN'],
    ['f.williams@demo.com', 'Favour Williams', 'Dentist', 'DEN'],
    ['j.timothy@demo.com', 'John Timothy', 'General Practitioner', 'GEN'],
    ['f.amos@demo.com', 'Dr. Fred Amos', 'Surgeon', 'SUR'],
  ];
  const doctors: string[] = [];
  const doctorDept: string[] = [];
  let docPhone = 8030001000;
  for (const [email, fullName, jobTitle, dept] of doctorDefs) {
    const u = await upsertUser(email, fullName, Role.DOCTOR, jobTitle, staffHash, {
      phone: '0' + docPhone++,
    });
    doctors.push(u.id);
    doctorDept.push(dept);
    await prisma.userDepartment.create({
      data: { tenantId: t, userId: u.id, departmentId: depts[dept], isPrimary: true },
    });
  }
  // Timothy (GP) also covers Paediatrics
  await prisma.userDepartment.create({
    data: { tenantId: t, userId: doctors[2], departmentId: depts.PAED, isPrimary: false },
  });

  // ── Doctor working hours (Mon-Fri; varied) ──
  await prisma.doctorShift.deleteMany({ where: { tenantId: t } });
  const shiftDefs: [number, number, number][] = [
    [480, 960, 1], // Jumbo    08:00-16:00
    [420, 780, 1], // Williams 07:00-13:00
    [540, 1020, 1], // Timothy 09:00-17:00
    [480, 840, 1], // Amos     08:00-14:00
  ];
  for (let di = 0; di < doctors.length; di++) {
    const [start, end] = shiftDefs[di];
    for (let day = 1; day <= 5; day++) {
      await prisma.doctorShift.create({
        data: { tenantId: t, doctorId: doctors[di], dayOfWeek: day, startMinute: start, endMinute: end },
      });
    }
  }
  // Williams also runs a Saturday morning clinic
  await prisma.doctorShift.create({
    data: { tenantId: t, doctorId: doctors[1], dayOfWeek: 6, startMinute: 480, endMinute: 720 },
  });

  // ── Wards & beds ──
  const wardDefs: [string, WardType, number][] = [
    ['General Ward A', WardType.GENERAL, 10],
    ['Private Wing', WardType.PRIVATE, 6],
    ['ICU', WardType.ICU, 4],
    ['Maternity', WardType.MATERNITY, 6],
  ];
  const wards: Record<string, string> = {};
  const bedByWard: Record<string, string[]> = {};
  for (const [name, wardType, count] of wardDefs) {
    const w = await prisma.ward.upsert({
      where: { tenantId_name: { tenantId: t, name } },
      update: { wardType },
      create: { tenantId: t, name, wardType },
    });
    wards[name] = w.id;
    bedByWard[w.id] = [];
    const prefix = name.split(' ').map((s) => s[0]).join('').toUpperCase();
    for (let i = 1; i <= count; i++) {
      const label = `${prefix}-${String(i).padStart(2, '0')}`;
      const b = await prisma.bed.upsert({
        where: { wardId_label: { wardId: w.id, label } },
        update: {},
        create: { tenantId: t, wardId: w.id, label, status: BedStatus.AVAILABLE },
      });
      bedByWard[w.id].push(b.id);
    }
  }

  // ── Clean transactional data so the seed is idempotent from any prior state ──
  await prisma.claimRemittanceAllocation.deleteMany({ where: { tenantId: t } });
  await prisma.claimRemittance.deleteMany({ where: { tenantId: t } });
  await prisma.insuranceClaimLine.deleteMany({ where: { tenantId: t } });
  await prisma.insuranceClaim.deleteMany({ where: { tenantId: t } });
  await prisma.claimBatch.deleteMany({ where: { tenantId: t } });
  await prisma.stockMovement.deleteMany({ where: { tenantId: t } });
  await prisma.drugBatch.deleteMany({ where: { tenantId: t } });
  await prisma.drug.deleteMany({ where: { tenantId: t } });
  await prisma.clinicalOrder.deleteMany({ where: { tenantId: t } });
  await prisma.clinicalNote.deleteMany({ where: { tenantId: t } });
  await prisma.prescription.deleteMany({ where: { tenantId: t } });
  await prisma.vitalSigns.deleteMany({ where: { tenantId: t } });
  await prisma.diagnosis.deleteMany({ where: { tenantId: t } });
  await prisma.complaint.deleteMany({ where: { tenantId: t } });
  await prisma.patientDocument.deleteMany({ where: { tenantId: t } });
  await prisma.payment.deleteMany({ where: { tenantId: t } });
  await prisma.invoiceLine.deleteMany({ where: { invoice: { tenantId: t } } });
  await prisma.invoice.deleteMany({ where: { tenantId: t } });
  await prisma.visit.deleteMany({ where: { tenantId: t } });
  await prisma.admission.deleteMany({ where: { tenantId: t } });
  await prisma.bed.updateMany({ where: { tenantId: t }, data: { status: BedStatus.AVAILABLE } });
  await prisma.patient.deleteMany({ where: { tenantId: t } });

  // ── Patients ──
  const patientDefs: [string, string, string, PayerType, string?, string?][] = [
    ['ThankGod Ogbonna', 'Male', '07089748984', PayerType.CASH],
    ['John Joe', 'Male', '09174897832', PayerType.HMO, 'Hygeia HMO', 'HYG-88213'],
    ['Abraham Samuel', 'Male', '09194857837', PayerType.CASH],
    ['Israel Jumbo', 'Male', '07057672884', PayerType.NHIS, undefined, 'NHIS-4471902'],
    ['Fred Joel', 'Male', '09198479749', PayerType.CASH],
    ['Amaka Chika', 'Female', '09158909383', PayerType.HMO, 'Reliance HMO', 'REL-22019'],
    ['Joy Francis', 'Female', '08107468827', PayerType.CASH],
  ];
  const patients: string[] = [];
  for (let i = 0; i < patientDefs.length; i++) {
    const [name, gender, phone, payerType, hmoName, hmoNumber] = patientDefs[i];
    const [firstName, ...rest] = name.split(' ');
    const patientNumber = `PT-${String(i + 1).padStart(5, '0')}`;
    const full = i < 4; // first four have a completed profile
    const p = await prisma.patient.upsert({
      where: { tenantId_patientNumber: { tenantId: t, patientNumber } },
      update: {},
      create: {
        tenantId: t,
        patientNumber,
        firstName,
        lastName: rest.join(' ') || firstName,
        gender,
        phone,
        email: `${firstName.toLowerCase()}.${(rest[0] ?? firstName).toLowerCase()}@example.com`,
        dateOfBirth: new Date(1985 + i, i, 12),
        nationality: 'Nigerian',
        occupation: ['Trader', 'Software engineer', 'Teacher', 'Driver', 'Nurse', 'Student', 'Farmer'][i],
        maritalStatus: (['SINGLE', 'MARRIED', 'MARRIED', 'SINGLE', 'WIDOWED', 'SINGLE', 'MARRIED'] as const)[i],
        address: `${10 + i} Aba Road`,
        city: 'Port Harcourt',
        state: 'Rivers',
        country: 'NG',
        payerType,
        hmoName,
        hmoNumber,
        assignedDoctorId: doctors[i % doctors.length],
        registrationStatus: full ? 'COMPLETE' : 'INCOMPLETE',
        registrationStep: full ? 8 : 3,
        ...(full
          ? {
              bloodGroup: (['O', 'A', 'B', 'AB'] as const)[i % 4],
              rhFactor: 'POSITIVE' as const,
              genotype: (['AA', 'AS', 'AA', 'AS'] as const)[i % 4],
              allergies: i === 1 ? 'Penicillin' : 'None known',
              chronicConditions: i === 2 ? 'Hypertension' : null,
              heightCm: 165 + i * 2,
              weightKg: 60 + i * 3,
              emergencyContactName: 'Next of kin',
              emergencyContactRelationship: (['Brother', 'Spouse', 'Sister', 'Parent'] as const)[i % 4],
              emergencyContactPhone: '0803' + (1000000 + i * 111111),
              consentTreatment: true,
              consentDataProcessing: true,
              consentGivenAt: new Date(),
            }
          : {}),
      },
    });
    patients.push(p.id);
  }

  // ── A little clinical history on the first patient ──
  const p0 = patients[0];
  await prisma.complaint.deleteMany({ where: { tenantId: t } });
  await prisma.diagnosis.deleteMany({ where: { tenantId: t } });
  await prisma.vitalSigns.deleteMany({ where: { tenantId: t } });
  await prisma.prescription.deleteMany({ where: { tenantId: t } });

  await prisma.patient.update({
    where: { id: p0 },
    data: {
      historyPresentingComplaint:
        'Recurrent frontal headache for 3 days, throbbing, worse in the afternoon, partially relieved by rest. No aura, no vomiting, no visual disturbance.',
      pastMedicalHistory: 'No prior admissions. No known hypertension or diabetes. Appendicectomy in 2016.',
      drugHistory: 'Occasional paracetamol for headache. No regular medication. No known drug allergy.',
      reproductiveHistory: 'Not applicable.',
      socialHistory: 'Trader. Does not smoke. Occasional alcohol. Lives with spouse and two children.',
    },
  });

  await prisma.complaint.create({
    data: { tenantId: t, patientId: p0, description: 'Recurrent headache for 3 days', onsetNote: '3 days ago', severity: 'Moderate', status: 'RESOLVED', recordedById: doctors[0], recordedAt: at(7, 35) },
  });
  await prisma.complaint.create({
    data: { tenantId: t, patientId: p0, description: 'Mild dizziness on standing, no fainting', onsetNote: 'Since yesterday', severity: 'Mild', status: 'OPEN', recordedById: doctors[2] },
  });
  await prisma.diagnosis.create({
    data: { tenantId: t, patientId: p0, description: 'Tension-type headache', code: 'G44.2', certainty: 'FINAL', attendanceType: 'Consultation', notes: 'Likely stress related. Advised hydration and regular sleep.', diagnosedById: doctors[0], diagnosedAt: at(7, 50) },
  });
  await prisma.diagnosis.create({
    data: { tenantId: t, patientId: p0, description: 'Rule out anaemia', certainty: 'DIFFERENTIAL', attendanceType: 'Consultation', notes: 'FBC requested.', diagnosedById: doctors[2] },
  });
  await prisma.vitalSigns.createMany({
    data: [
      { tenantId: t, patientId: p0, temperatureC: 36.8, pulseBpm: 78, respiratoryRate: 16, systolicBp: 120, diastolicBp: 80, spo2: 98, weightKg: 55, heightCm: 167, bmi: 19.7, bloodGlucose: 5.4, urineOutputMl: 1400, avpu: 'A', recordedById: doctors[0], recordedAt: at(7, 40) },
      { tenantId: t, patientId: p0, temperatureC: 38.6, pulseBpm: 104, respiratoryRate: 22, systolicBp: 148, diastolicBp: 96, spo2: 94, weightKg: 55, bmi: 19.7, bloodGlucose: 8.9, urineOutputMl: 900, avpu: 'A', notes: 'Febrile, review after antipyretic.', recordedById: doctors[2] },
    ],
  });
  await prisma.prescription.create({
    data: {
      tenantId: t, patientId: p0, status: 'ACTIVE', notes: 'For headache. Review in one week if not improving.', prescribedById: doctors[0], prescribedAt: at(7, 55),
      items: {
        create: [
          { tenantId: t, drugName: 'Paracetamol', dosageForm: 'Tablet', strengthConc: '500 mg', amountPerUse: '2 tablets', frequency: 'TID', route: 'PO (Oral)', foodRelation: 'After food', durationType: 'Days', durationNumber: 3 },
          { tenantId: t, drugName: 'Ibuprofen', dosageForm: 'Tablet', strengthConc: '400 mg', amountPerUse: '1 tablet', frequency: 'BD', route: 'PO (Oral)', foodRelation: 'With food', durationType: 'Days', durationNumber: 5, instructions: 'Stop if abdominal pain.' },
        ],
      },
    },
  });

  // ── Today's appointments ──
  await prisma.visit.deleteMany({ where: { tenantId: t } });
  const apptDefs: [number, Date, number, VisitType, VisitStatus, string][] = [
    [0, at(7, 30), 60, VisitType.CONSULTATION, VisitStatus.COMPLETED, 'Medical checkup'],
    [0, at(9, 30), 60, VisitType.FOLLOW_UP, VisitStatus.SCHEDULED, 'Follow-up review'],
    [1, at(8, 0), 60, VisitType.CONSULTATION, VisitStatus.CHECKED_IN, 'Toothache'],
    [2, at(8, 30), 60, VisitType.CONSULTATION, VisitStatus.SCHEDULED, 'General checkup'],
    [3, at(10, 0), 60, VisitType.WALK_IN, VisitStatus.IN_PROGRESS, 'Chest pain'],
    [2, at(11, 0), 30, VisitType.FOLLOW_UP, VisitStatus.SCHEDULED, 'Dressing change'],
  ];
  const inProgressOrDone: VisitStatus[] = [VisitStatus.IN_PROGRESS, VisitStatus.COMPLETED];
  let p0VisitId = '';
  for (let i = 0; i < apptDefs.length; i++) {
    const [dIdx, start, min, type, status, reason] = apptDefs[i];
    const visit = await prisma.visit.create({
      data: {
        tenantId: t,
        patientId: patients[i % patients.length],
        doctorId: doctors[dIdx],
        departmentId: depts[doctorDept[dIdx]],
        visitType: type,
        status,
        startsAt: start,
        endsAt: plusMin(start, min),
        reason,
        payerType: PayerType.CASH,
        checkedInAt: status !== VisitStatus.SCHEDULED ? start : null,
        startedAt: inProgressOrDone.includes(status) ? plusMin(start, 5) : null,
        completedAt: status === VisitStatus.COMPLETED ? plusMin(start, 45) : null,
      },
    });
    if (i === 0) p0VisitId = visit.id;
  }

  // ── One current inpatient ──
  await prisma.admission.deleteMany({ where: { tenantId: t } });
  const gwaBeds = bedByWard[wards['General Ward A']];
  await prisma.$transaction([
    prisma.admission.create({
      data: {
        tenantId: t,
        admissionNumber: 'ADM-000001',
        patientId: patients[4],
        admittingDoctorId: doctors[3],
        attendingDoctorId: doctors[3],
        departmentId: depts.SUR,
        wardId: wards['General Ward A'],
        bedId: gwaBeds[0],
        admissionType: AdmissionType.EMERGENCY,
        reason: 'Acute appendicitis',
        provisionalDiagnosis: 'Appendicitis for appendectomy',
        payerType: PayerType.CASH,
        admittedAt: at(6, 0),
      },
    }),
    prisma.bed.update({ where: { id: gwaBeds[0] }, data: { status: BedStatus.OCCUPIED } }),
  ]);

  // ── Service items ──
  const services: [string, string, number][] = [
    ['General Consultation', 'Consultation', 5000],
    ['Specialist Consultation', 'Consultation', 10000],
    ['Malaria Test', 'Laboratory', 3500],
    ['Full Blood Count', 'Laboratory', 6000],
    ['Fasting Blood Sugar', 'Laboratory', 3000],
    ['Urinalysis', 'Laboratory', 2500],
    ['Chest X-ray', 'Imaging', 12000],
    ['Abdominal Ultrasound', 'Imaging', 15000],
    ['Wound Dressing', 'Procedure', 4000],
    ['Nebulisation', 'Procedure', 5000],
    ['Dental Scaling & Polishing', 'Dental', 15000],
    ['Daily Bed Fee (General)', 'Admission', 8000],
  ];
  let svcSeq = 1;
  for (const [name, category, unitPrice] of services) {
    const code = `SVC-${String(svcSeq++).padStart(3, '0')}`;
    await prisma.serviceItem.upsert({
      where: { tenantId_name: { tenantId: t, name } },
      update: { unitPrice, category, code },
      create: { tenantId: t, name, category, unitPrice, code },
    });
  }

  // ── Insurance providers / corporate accounts (payer registry) ──
  await prisma.insuranceProvider.deleteMany({ where: { tenantId: t } });
  const providerDefs: [string, InsuranceKind, string, string, string][] = [
    ['Hygeia HMO', InsuranceKind.HMO, '02012700700', 'provider.relations@hygeiahmo.com', 'Ada Nwosu'],
    ['Reliance HMO', InsuranceKind.HMO, '018884000', 'care@reliancehmo.com', 'Bola Ade'],
    ['AXA Mansard', InsuranceKind.INSURANCE, '02012800800', 'health@axamansard.com', 'Ify Eze'],
    ['NHIS', InsuranceKind.NHIS, '094611031', 'info@nhis.gov.ng', 'Desk Officer'],
    ['Dangote Group', InsuranceKind.COMPANY, '014485500', 'clinic@dangote.com', 'HR Medicals'],
  ];
  const providerId: Record<string, string> = {};
  for (const [name, kind, phone, email, contactPerson] of providerDefs) {
    const hmoLike = kind === InsuranceKind.HMO;
    const p = await prisma.insuranceProvider.create({
      data: {
        tenantId: t,
        name,
        kind,
        phone,
        email,
        contactPerson,
        defaultCoPayPct: hmoLike ? 10 : null,
        claimEmail: hmoLike ? `claims@${email.split('@')[1]}` : null,
      },
    });
    providerId[name] = p.id;
  }

  // ── Drug formulary + batch stock + a little dispensing history ──
  const daysAgo = (n: number, hour = 9) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  type DrugDef = {
    name: string; generic?: string; form: string; strength: string; packaging: string;
    unit: string; sell: number; cost: number; reorder: number;
    openingQty: number; expiryInDays: number; batchNo: string; highVolume?: boolean;
  };
  const drugDefs: DrugDef[] = [
    { name: 'Paracetamol', form: 'Tablet', strength: '500 mg', packaging: 'Blister', unit: 'tablet', sell: 20, cost: 12, reorder: 300, openingQty: 2400, expiryInDays: 560, batchNo: 'PCM-241', highVolume: true },
    { name: 'Ibuprofen', form: 'Tablet', strength: '400 mg', packaging: 'Blister', unit: 'tablet', sell: 30, cost: 18, reorder: 200, openingQty: 1400, expiryInDays: 430, batchNo: 'IBU-108', highVolume: true },
    { name: 'Amoxicillin', generic: 'Amoxicillin', form: 'Capsule', strength: '500 mg', packaging: 'Blister', unit: 'capsule', sell: 45, cost: 28, reorder: 120, openingQty: 60, expiryInDays: 260, batchNo: 'AMX-77' },
    { name: 'Artemether/Lumefantrine', generic: 'Artemether + Lumefantrine', form: 'Tablet', strength: '20/120 mg', packaging: 'Pack', unit: 'tablet', sell: 90, cost: 60, reorder: 120, openingQty: 720, expiryInDays: 480, batchNo: 'ACT-330', highVolume: true },
    { name: 'Oral Rehydration Salts', generic: 'ORS', form: 'Sachet', strength: '20.5 g', packaging: 'Sachet', unit: 'sachet', sell: 150, cost: 90, reorder: 100, openingQty: 500, expiryInDays: 640, batchNo: 'ORS-51', highVolume: true },
    { name: 'Metronidazole', form: 'Tablet', strength: '400 mg', packaging: 'Blister', unit: 'tablet', sell: 25, cost: 15, reorder: 200, openingQty: 1600, expiryInDays: 520, batchNo: 'MTZ-14', highVolume: true },
    { name: 'Amlodipine', form: 'Tablet', strength: '5 mg', packaging: 'Blister', unit: 'tablet', sell: 35, cost: 20, reorder: 90, openingQty: 30, expiryInDays: 25, batchNo: 'AML-09' },
    { name: 'Metformin', form: 'Tablet', strength: '500 mg', packaging: 'Blister', unit: 'tablet', sell: 25, cost: 14, reorder: 150, openingQty: 1500, expiryInDays: 600, batchNo: 'MET-201' },
    { name: 'Ceftriaxone', form: 'Injection', strength: '1 g', packaging: 'Vial', unit: 'vial', sell: 1200, cost: 800, reorder: 40, openingQty: 30, expiryInDays: 360, batchNo: 'CTX-5' },
    { name: 'Artesunate', form: 'Injection', strength: '60 mg', packaging: 'Ampoule', unit: 'ampoule', sell: 1500, cost: 950, reorder: 30, openingQty: 0, expiryInDays: 300, batchNo: 'AS-1' },
    { name: 'Chlorphenamine', generic: 'Chlorpheniramine', form: 'Tablet', strength: '4 mg', packaging: 'Blister', unit: 'tablet', sell: 15, cost: 8, reorder: 100, openingQty: 700, expiryInDays: 450, batchNo: 'CPM-3' },
    { name: 'Salbutamol Inhaler', generic: 'Salbutamol', form: 'Inhaler', strength: '100 mcg/dose', packaging: 'Each', unit: 'inhaler', sell: 2500, cost: 1700, reorder: 15, openingQty: 40, expiryInDays: 390, batchNo: 'VEN-22' },
    { name: 'Hydrocortisone Cream', generic: 'Hydrocortisone', form: 'Cream', strength: '1%', packaging: 'Tube', unit: 'tube', sell: 700, cost: 450, reorder: 20, openingQty: 55, expiryInDays: 40, batchNo: 'HC-7' },
    { name: 'Zinc Sulphate', generic: 'Zinc', form: 'Tablet', strength: '20 mg', packaging: 'Blister', unit: 'tablet', sell: 20, cost: 11, reorder: 120, openingQty: 900, expiryInDays: 570, batchNo: 'ZN-2' },
    { name: 'Ferrous Sulphate', generic: 'Ferrous sulfate', form: 'Tablet', strength: '200 mg', packaging: 'Blister', unit: 'tablet', sell: 18, cost: 10, reorder: 150, openingQty: 1100, expiryInDays: 620, batchNo: 'FE-4' },
    { name: 'Omeprazole', form: 'Capsule', strength: '20 mg', packaging: 'Blister', unit: 'capsule', sell: 40, cost: 24, reorder: 90, openingQty: 800, expiryInDays: 500, batchNo: 'OME-6' },
  ];

  const drugByName: Record<string, string> = {};
  let skuSeq = 0;
  for (const dd of drugDefs) {
    const sku = `MED-${(1000 + skuSeq++).toString(36).toUpperCase().padStart(4, '0')}`;
    const drug = await prisma.drug.create({
      data: {
        tenantId: t, sku, name: dd.name, genericName: dd.generic, form: dd.form,
        strength: dd.strength, packaging: dd.packaging, unitLabel: dd.unit,
        sellPrice: dd.sell, costPrice: dd.cost, reorderLevel: dd.reorder,
        quantityOnHand: dd.openingQty, createdById: pharmacist.id,
        createdAt: daysAgo(dd.highVolume ? 55 : 20),
      },
    });
    drugByName[dd.name] = drug.id;

    const batch = await prisma.drugBatch.create({
      data: {
        tenantId: t, drugId: drug.id, batchNumber: dd.batchNo,
        expiryDate: inDays(dd.expiryInDays), quantity: dd.openingQty, costPrice: dd.cost,
        supplier: 'Emzor Pharmaceuticals', receivedById: pharmacist.id,
        receivedAt: daysAgo(dd.highVolume ? 55 : 20),
      },
    });
    if (dd.openingQty > 0) {
      await prisma.stockMovement.create({
        data: {
          tenantId: t, drugId: drug.id, batchId: batch.id, type: 'OPENING',
          quantity: dd.openingQty, createdById: pharmacist.id,
          createdAt: daysAgo(dd.highVolume ? 55 : 20),
        },
      });
    }

    // dispensing history for the busy items (drives the per-drug chart)
    if (dd.highVolume) {
      let onHand = dd.openingQty;
      let batchQty = dd.openingQty;
      for (let k = 0; k < 12; k++) {
        const qty = 4 + Math.floor(Math.random() * 30);
        if (batchQty - qty < 0) break;
        batchQty -= qty;
        onHand -= qty;
        await prisma.stockMovement.create({
          data: {
            tenantId: t, drugId: drug.id, batchId: batch.id, type: 'DISPENSE',
            quantity: -qty, unitPrice: dd.sell, createdById: pharmacist.id,
            createdAt: daysAgo(Math.floor(k / 2), 8 + (k % 8)),
          },
        });
      }
      await prisma.drugBatch.update({ where: { id: batch.id }, data: { quantity: batchQty } });
      await prisma.drug.update({ where: { id: drug.id }, data: { quantityOnHand: onHand } });
    }
  }

  // ── Patient 1's completed encounter: link documentation, note, a resulted lab, and the visit invoice ──
  const consult = await prisma.serviceItem.findFirst({ where: { tenantId: t, name: 'General Consultation' } });
  const fbc = await prisma.serviceItem.findFirst({ where: { tenantId: t, name: 'Full Blood Count' } });

  await prisma.complaint.updateMany({ where: { patientId: p0 }, data: { visitId: p0VisitId } });
  await prisma.diagnosis.updateMany({ where: { patientId: p0 }, data: { visitId: p0VisitId } });
  await prisma.vitalSigns.updateMany({ where: { patientId: p0 }, data: { visitId: p0VisitId } });
  await prisma.prescription.updateMany({
    where: { patientId: p0 },
    data: {
      visitId: p0VisitId,
      dispenseStatus: 'DISPENSED',
      dispensedById: pharmacist.id,
      dispensedAt: at(8, 20),
    },
  });
  for (const it of await prisma.prescriptionItem.findMany({ where: { prescription: { patientId: p0 } } })) {
    await prisma.prescriptionItem.update({
      where: { id: it.id },
      data: {
        drugId: drugByName[it.drugName] ?? null,
        dispensedQty: (it.durationNumber ?? 3) * 2,
        dispenseUnitPrice: 60,
      },
    });
  }

  await prisma.clinicalNote.create({
    data: {
      tenantId: t, patientId: p0, visitId: p0VisitId, authorId: doctors[0],
      subjective: 'Recurrent frontal headache for 3 days, throbbing, worse in the afternoon. No aura or vomiting. Mild dizziness on standing since yesterday.',
      objective: 'Alert, not in distress. BP 120/80, T 36.8. Neurological examination normal. No neck stiffness.',
      assessment: 'Tension-type headache. Query mild anaemia given dizziness (FBC requested).',
      plan: 'Paracetamol and ibuprofen for 3-5 days. Advised hydration, regular sleep, reduce screen time. Review in one week if not improving. FBC done.',
    },
  });

  const fbcOrder = await prisma.clinicalOrder.create({
    data: {
      tenantId: t, patientId: p0, visitId: p0VisitId, serviceItemId: fbc?.id ?? null,
      orderType: 'LABORATORY', name: 'Full Blood Count', status: 'RESULTED', priority: 'Routine',
      clinicalNote: 'Dizziness on standing, query anaemia.',
      orderedById: doctors[0], orderedAt: at(7, 52),
      resultValue: 'Hb 10.4', resultUnit: 'g/dL', referenceRange: '12 - 16', abnormalFlag: 'Low',
      resultNote: 'Mild normocytic anaemia. Suggest haematinics and dietary advice.',
      resultedById: labStaff.id, resultedAt: at(9, 10),
    },
  });

  // A second prescription left PENDING so the pharmacy queue has work
  await prisma.prescription.create({
    data: {
      tenantId: t, patientId: patients[2], status: 'ACTIVE', dispenseStatus: 'PENDING',
      notes: 'Malaria treatment.', prescribedById: doctors[2], prescribedAt: at(9, 5),
      items: {
        create: [
          { tenantId: t, drugId: drugByName['Artemether/Lumefantrine'], drugName: 'Artemether/Lumefantrine', dosageForm: 'Tablet', strengthConc: '20/120 mg', amountPerUse: '4 tablets', frequency: 'BD (twice a day)', route: 'PO (Oral)', foodRelation: 'After food', durationType: 'Days', durationNumber: 3 },
          { tenantId: t, drugId: drugByName['Paracetamol'], drugName: 'Paracetamol', dosageForm: 'Tablet', strengthConc: '500 mg', amountPerUse: '2 tablets', frequency: 'TID (three times a day)', route: 'PO (Oral)', foodRelation: 'After food', durationType: 'Days', durationNumber: 3 },
        ],
      },
    },
  });

  let invSeq = await prisma.invoice.count({ where: { tenantId: t } });
  const invNo = () => `INV-${String(++invSeq).padStart(6, '0')}`;
  let rcpSeq = 0;
  const rcpNo = () => `RCP-${String(++rcpSeq).padStart(6, '0')}`;
  const gl = (unitPrice: number, qty: number) => ({ tenantId: t, grossAmount: unitPrice * qty });

  const visitInvoice = await prisma.invoice.create({
    data: {
      tenantId: t, patientId: p0, visitId: p0VisitId, createdById: doctors[0],
      invoiceNumber: invNo(),
      category: 'Consultation', status: 'PARTIAL', subtotal: 11720, totalAmount: 11720, createdAt: at(8, 5),
      lines: {
        create: [
          { serviceItemId: consult?.id ?? null, category: 'Consultation', description: 'General Consultation', quantity: 1, unitPrice: 5000, ...gl(5000, 1), lineTotal: 5000, providedById: doctors[0], providedAt: at(8, 0) },
          { serviceItemId: fbc?.id ?? null, orderId: fbcOrder.id, category: 'Laboratory', description: 'Full Blood Count', quantity: 1, unitPrice: 6000, ...gl(6000, 1), lineTotal: 6000, providedById: labStaff.id, providedAt: at(9, 10) },
          { category: 'Pharmacy', description: 'Paracetamol 500 mg x6', quantity: 6, unitPrice: 60, ...gl(60, 6), lineTotal: 360, providedById: pharmacist.id, providedAt: at(8, 20) },
          { category: 'Pharmacy', description: 'Ibuprofen 400 mg x10', quantity: 10, unitPrice: 36, ...gl(36, 10), lineTotal: 360, providedById: pharmacist.id, providedAt: at(8, 20) },
        ],
      },
      payments: { create: [{ tenantId: t, receiptNumber: rcpNo(), amount: 5000, method: 'CASH', payerType: 'CASH', receivedById: accountant.id, paidAt: at(8, 10) }] },
    },
  });
  const labLine = await prisma.invoiceLine.findFirst({ where: { invoiceId: visitInvoice.id, orderId: fbcOrder.id } });
  if (labLine) await prisma.clinicalOrder.update({ where: { id: fbcOrder.id }, data: { invoiceLineId: labLine.id } });

  // ── Standalone billing-office invoices (walk-ins, corrections) ──
  const xray = await prisma.serviceItem.findFirst({ where: { tenantId: t, name: 'Chest X-ray' } });
  const wound = await prisma.serviceItem.findFirst({ where: { tenantId: t, name: 'Wound Dressing' } });
  const paraDrug = await prisma.drug.findFirst({ where: { tenantId: t, name: 'Paracetamol' } });

  // walk-in pharmacy sale, paid cash in full
  await prisma.invoice.create({
    data: {
      tenantId: t, patientId: patients[1], createdById: accountant.id, invoiceNumber: invNo(),
      category: 'Medication', payerType: 'CASH', status: 'PAID', subtotal: 400, totalAmount: 400, createdAt: daysAgo(1, 11),
      lines: { create: [{ drugId: paraDrug?.id ?? null, category: 'Medication', description: 'Paracetamol 500 mg', quantity: 20, unitPrice: 20, ...gl(20, 20), lineTotal: 400, providedById: accountant.id, providedAt: daysAgo(1, 11) }] },
      payments: { create: [{ tenantId: t, receiptNumber: rcpNo(), amount: 400, method: 'CASH', payerType: 'CASH', receivedById: accountant.id, paidAt: daysAgo(1, 11) }] },
    },
  });

  // standalone imaging, HMO, part-paid, with a 10% invoice discount
  await prisma.invoice.create({
    data: {
      tenantId: t, patientId: patients[5], createdById: accountant.id, invoiceNumber: invNo(),
      category: 'Imaging', payerType: 'HMO', status: 'PARTIAL',
      discountPct: 10, discountReason: 'Staff dependant', subtotal: 12000, totalAmount: 10800, createdAt: daysAgo(2, 14),
      lines: { create: [{ serviceItemId: xray?.id ?? null, category: 'Imaging', description: 'Chest X-ray', quantity: 1, unitPrice: 12000, ...gl(12000, 1), lineTotal: 12000, providedById: accountant.id, providedAt: daysAgo(2, 14) }] },
      payments: { create: [{ tenantId: t, receiptNumber: rcpNo(), amount: 5000, method: 'TRANSFER', payerType: 'HMO', payerName: 'Reliance HMO', reference: 'RLC-88213', receivedById: accountant.id, paidAt: daysAgo(2, 15) }] },
    },
  });

  // cancelled invoice (billed in error)
  await prisma.invoice.create({
    data: {
      tenantId: t, patientId: patients[2], createdById: accountant.id, invoiceNumber: invNo(),
      category: 'Procedure', payerType: 'CASH', status: 'CANCELLED',
      subtotal: 4000, totalAmount: 4000, note: 'Duplicate of INV for this visit',
      cancelledAt: daysAgo(3, 10), cancelledById: accountant.id, voidReason: 'Raised in error, patient already billed on the visit invoice',
      createdAt: daysAgo(3, 9),
      lines: { create: [{ serviceItemId: wound?.id ?? null, category: 'Procedure', description: 'Wound Dressing', quantity: 1, unitPrice: 4000, ...gl(4000, 1), lineTotal: 4000, providedById: accountant.id, providedAt: daysAgo(3, 9) }] },
    },
  });

  // ── HMO claims: linked patients, visit invoices, claims across the lifecycle ──
  await prisma.patient.updateMany({
    where: { tenantId: t, hmoName: 'Hygeia HMO' },
    data: { insuranceProviderId: providerId['Hygeia HMO'] },
  });
  await prisma.patient.updateMany({
    where: { tenantId: t, hmoName: 'Reliance HMO' },
    data: { insuranceProviderId: providerId['Reliance HMO'] },
  });

  const hygeiaId = providerId['Hygeia HMO'];
  const relianceId = providerId['Reliance HMO'];
  const johnJoe = patients[1];
  const amaka = patients[5];

  let clmSeq = 0;
  const clmNo = () => `CLM-${String(++clmSeq).padStart(6, '0')}`;

  const makeHmoVisit = async (
    patientId: string,
    provId: string,
    hmoName: string,
    hmoNumber: string,
    dIdx: number,
    daysBack: number,
  ) => {
    const start = daysAgo(daysBack, 9);
    const visit = await prisma.visit.create({
      data: {
        tenantId: t, patientId, doctorId: doctors[dIdx], departmentId: depts[doctorDept[dIdx]],
        insuranceProviderId: provId, visitType: VisitType.CONSULTATION, status: VisitStatus.COMPLETED,
        startsAt: start, endsAt: plusMin(start, 45), reason: 'Consultation',
        payerType: PayerType.HMO, hmoName, authCode: `AUTH-${hmoNumber}`,
        checkedInAt: start, startedAt: plusMin(start, 5), completedAt: plusMin(start, 45),
      },
    });
    const inv = await prisma.invoice.create({
      data: {
        tenantId: t, patientId, visitId: visit.id, createdById: doctors[dIdx], invoiceNumber: invNo(),
        category: 'Consultation', payerType: PayerType.HMO, status: 'UNPAID',
        subtotal: 11000, totalAmount: 11000, createdAt: start,
        lines: {
          create: [
            { serviceItemId: consult?.id ?? null, category: 'Consultation', description: 'General Consultation', quantity: 1, unitPrice: 5000, ...gl(5000, 1), lineTotal: 5000, providedById: doctors[dIdx], providedAt: start },
            { serviceItemId: fbc?.id ?? null, category: 'Laboratory', description: 'Full Blood Count', quantity: 1, unitPrice: 6000, ...gl(6000, 1), lineTotal: 6000, providedById: doctors[dIdx], providedAt: start },
          ],
        },
      },
      include: { lines: true },
    });
    return { visit, inv, start };
  };
  const claimLines = (inv: { lines: { id: string; description: string; quantity: number; unitPrice: any; lineTotal: any }[] }) =>
    inv.lines.map((l) => ({
      tenantId: t, invoiceLineId: l.id, description: l.description, quantity: l.quantity,
      unitPrice: l.unitPrice, claimedAmount: Number(l.lineTotal) * 0.9, covered: true,
    }));

  // Claim A: DRAFT, unbatched
  {
    const { inv, start } = await makeHmoVisit(johnJoe, hygeiaId, 'Hygeia HMO', 'HYG-88213', 0, 6);
    await prisma.insuranceClaim.create({
      data: {
        tenantId: t, claimNumber: clmNo(), providerId: hygeiaId, patientId: johnJoe, visitId: inv.visitId, invoiceId: inv.id,
        memberName: 'John Joe', memberNumber: 'HYG-88213', authCode: 'AUTH-HYG-88213', serviceDate: start,
        diagnosisSummary: 'Tension headache', claimedAmount: 9900, patientResponsibility: 1100, status: 'DRAFT',
        createdById: accountant.id, lines: { create: claimLines(inv) },
      },
    });
  }

  // Claim B: SUBMITTED, inside a SUBMITTED batch
  {
    const { inv, start } = await makeHmoVisit(johnJoe, hygeiaId, 'Hygeia HMO', 'HYG-88213', 2, 20);
    const batch = await prisma.claimBatch.create({
      data: {
        tenantId: t, batchNumber: 'BATCH-000001', providerId: hygeiaId,
        periodStart: daysAgo(35), periodEnd: daysAgo(5), status: 'SUBMITTED', submittedAt: daysAgo(4),
        submissionRef: 'HYG/2026/04', claimCount: 1, claimedTotal: 9900, createdById: accountant.id,
      },
    });
    await prisma.insuranceClaim.create({
      data: {
        tenantId: t, claimNumber: clmNo(), providerId: hygeiaId, patientId: johnJoe, visitId: inv.visitId, invoiceId: inv.id,
        batchId: batch.id, memberName: 'John Joe', memberNumber: 'HYG-88213', authCode: 'AUTH-HYG-88213', serviceDate: start,
        diagnosisSummary: 'Malaria', claimedAmount: 9900, patientResponsibility: 1100, status: 'SUBMITTED', submittedAt: daysAgo(4),
        createdById: accountant.id, lines: { create: claimLines(inv) },
      },
    });
  }

  // Claim C: PART_PAID, with a remittance and a real payment on the invoice
  {
    const { inv, start } = await makeHmoVisit(amaka, relianceId, 'Reliance HMO', 'REL-22019', 3, 45);
    const claim = await prisma.insuranceClaim.create({
      data: {
        tenantId: t, claimNumber: clmNo(), providerId: relianceId, patientId: amaka, visitId: inv.visitId, invoiceId: inv.id,
        memberName: 'Amaka Chika', memberNumber: 'REL-22019', authCode: 'AUTH-REL-22019', serviceDate: start,
        diagnosisSummary: 'Hypertension review', claimedAmount: 9900, patientResponsibility: 1100,
        approvedAmount: 9900, paidAmount: 7000, status: 'PART_PAID', submittedAt: daysAgo(40), adjudicatedAt: daysAgo(12),
        createdById: accountant.id, lines: { create: claimLines(inv) },
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: t, invoiceId: inv.id, receiptNumber: rcpNo(), amount: 7000, method: 'TRANSFER', payerType: 'HMO',
        payerName: 'Reliance HMO', reference: 'RLC/RMT/0007', note: 'Remittance RMT-000001', receivedById: accountant.id, paidAt: daysAgo(12),
      },
    });
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'PARTIAL' } });
    const rmt = await prisma.claimRemittance.create({
      data: {
        tenantId: t, remittanceNumber: 'RMT-000001', providerId: relianceId, receivedAmount: 7000, allocatedAmount: 7000,
        reference: 'RLC/RMT/0007', receivedAt: daysAgo(12), recordedById: accountant.id,
      },
    });
    await prisma.claimRemittanceAllocation.create({
      data: {
        tenantId: t, remittanceId: rmt.id, claimId: claim.id, approvedAmount: 9900, paidAmount: 7000, shortfall: 0, paymentId: payment.id,
      },
    });
  }

  // Claim D: REJECTED
  {
    const { inv, start } = await makeHmoVisit(johnJoe, hygeiaId, 'Hygeia HMO', 'HYG-88213', 0, 30);
    await prisma.insuranceClaim.create({
      data: {
        tenantId: t, claimNumber: clmNo(), providerId: hygeiaId, patientId: johnJoe, visitId: inv.visitId, invoiceId: inv.id,
        memberName: 'John Joe', memberNumber: 'HYG-88213', serviceDate: start, diagnosisSummary: 'Upper respiratory tract infection',
        claimedAmount: 9900, patientResponsibility: 1100, approvedAmount: 0, status: 'REJECTED',
        submittedAt: daysAgo(25), adjudicatedAt: daysAgo(8), closedAt: daysAgo(8),
        rejectionReason: 'No valid pre-authorisation code on file',
        createdById: accountant.id, lines: { create: claimLines(inv) },
      },
    });
  }

  console.log('✓ Seeded Demo Hospital  (http://demo.localhost:3001)');
  console.log('  admin@demo.com / Admin1234!       (HOSPITAL_ADMIN)');
  console.log('  reception@demo.com / Password1    (RECEPTIONIST)');
  console.log('  nurse@demo.com / Password1        (NURSE)');
  console.log('  j.jumbo@demo.com / Password1      (DOCTOR)');
  console.log('  pharmacy@demo.com / Password1     (PHARMACIST)');
  console.log('  lab@demo.com / Password1          (LAB_STAFF)');
  console.log('  accounts@demo.com / Password1     (ACCOUNTANT)');
  console.log('  grace@demo.com / Password1        (NURSE, inactive)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
