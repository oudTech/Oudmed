import { z } from 'zod'

/**
 * Patient registration validation. The API (apps/api) remains the enforcement
 * authority via class-validator DTOs; this schema drives the front-end
 * registration wizard (apps/web/app/(protected)/patients/new) so each step is
 * checked before it is persisted. Enum lists mirror the Prisma enums.
 */

export const MARITAL_STATUS = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED'] as const
export const BLOOD_GROUPS = ['A', 'B', 'AB', 'O'] as const
export const RH_FACTORS = ['POSITIVE', 'NEGATIVE'] as const
export const GENOTYPES = ['AA', 'AS', 'SS', 'AC', 'SC', 'CC'] as const
export const PREGNANCY_STATUS = ['NOT_APPLICABLE', 'NOT_PREGNANT', 'PREGNANT', 'UNKNOWN'] as const
export const ID_DOC_TYPES = [
  'NATIONAL_ID',
  'DRIVERS_LICENSE',
  'PASSPORT',
  'VOTERS_CARD',
  'NHIS_CARD',
  'OTHER',
] as const
export const PAYER_TYPES = ['CASH', 'HMO', 'NHIS', 'RETAINER'] as const

// ── field helpers ──────────────────────────────────────────────────────────
/** An optional free-text field: blank or up to `max` characters (trimmed). */
const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`).optional()

/** An optional enum: blank or one of `values`. */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.literal('')]).optional()

/** Blank or a parseable date string; `future` decides whether tomorrow is allowed. */
const dateField = (opts: { future: boolean; msg?: string }) =>
  z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => {
        if (!v) return true
        const t = Date.parse(v)
        if (Number.isNaN(t)) return false
        return opts.future || t <= Date.now()
      },
      { message: opts.msg ?? 'Enter a valid date' },
    )

/** Blank or a number within [min, max]; kept as a string (the API coerces). */
const numericText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => v === undefined || v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max),
      { message: `Enter a value between ${min} and ${max}` },
    )

// ── per-step field groups ──────────────────────────────────────────────────
const personal = {
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  middleName: text(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  gender: text(20),
  dateOfBirth: dateField({ future: false, msg: 'Date of birth cannot be in the future' }),
  maritalStatus: optionalEnum(MARITAL_STATUS),
  nationality: text(60),
  occupation: text(80),
  phone: text(30),
  altPhone: text(30),
  email: z.union([z.string().trim().email('Enter a valid email address'), z.literal('')]).optional(),
  address: text(200),
  city: text(80),
  state: text(80),
  country: z.string().trim().length(2, 'Select a country').optional().or(z.literal('')),
}

const emergency = {
  emergencyContactName: text(120),
  emergencyContactRelationship: text(60),
  emergencyContactPhone: text(30),
  emergencyContactAltPhone: text(30),
  emergencyContactAddress: text(250),
}

const medical = {
  bloodGroup: optionalEnum(BLOOD_GROUPS),
  rhFactor: optionalEnum(RH_FACTORS),
  genotype: optionalEnum(GENOTYPES),
  allergies: text(1000),
  chronicConditions: text(1000),
  currentMedications: text(1000),
  previousSurgeries: text(1000),
  disabilities: text(1000),
  pregnancyStatus: optionalEnum(PREGNANCY_STATUS),
  familyHistory: text(1000),
  heightCm: numericText(20, 280),
  weightKg: numericText(0, 700),
}

const payer = {
  payerType: z.enum(PAYER_TYPES),
  hmoName: text(120),
  hmoNumber: text(60),
  insuranceProvider: text(120),
  insuranceNumber: text(80),
  insurancePlanType: text(60),
  insuranceEmployer: text(120),
  insuranceExpiry: dateField({ future: true }),
}

const identification = {
  idDocumentType: optionalEnum(ID_DOC_TYPES),
  idDocumentNumber: text(60),
}

const consent = {
  consentTreatment: z.boolean(),
  consentDataProcessing: z.boolean(),
}

export const registrationSchema = z
  .object({
    ...personal,
    ...emergency,
    ...medical,
    ...payer,
    ...identification,
    ...consent,
  })
  .superRefine((v, ctx) => {
    // A HMO / retainer patient needs at least a scheme name and membership number
    // so claims can be raised later.
    if (v.payerType === 'HMO' && !v.hmoName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hmoName'], message: 'HMO name is required' })
    }
    if ((v.payerType === 'HMO' || v.payerType === 'NHIS') && !v.hmoNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hmoNumber'],
        message: 'Policy / scheme number is required',
      })
    }
  })

export type RegistrationForm = z.infer<typeof registrationSchema>

/** Empty wizard state (also the RHF defaultValues). */
export const registrationDefaults: RegistrationForm = {
  firstName: '', middleName: '', lastName: '', gender: '', dateOfBirth: '',
  maritalStatus: '', nationality: '', occupation: '', phone: '', altPhone: '',
  email: '', address: '', city: '', state: '', country: 'NG',
  emergencyContactName: '', emergencyContactRelationship: '', emergencyContactPhone: '',
  emergencyContactAltPhone: '', emergencyContactAddress: '',
  bloodGroup: '', rhFactor: '', genotype: '', allergies: '', chronicConditions: '',
  currentMedications: '', previousSurgeries: '', disabilities: '', pregnancyStatus: '',
  familyHistory: '', heightCm: '', weightKg: '',
  payerType: 'CASH', hmoName: '', hmoNumber: '', insuranceProvider: '', insuranceNumber: '',
  insurancePlanType: '', insuranceEmployer: '', insuranceExpiry: '',
  idDocumentType: '', idDocumentNumber: '',
  consentTreatment: false, consentDataProcessing: false,
}

/** Wizard step number -> the fields RHF should validate before advancing. */
export const REGISTRATION_STEP_FIELDS: Record<number, (keyof RegistrationForm)[]> = {
  2: Object.keys(personal) as (keyof RegistrationForm)[],
  3: Object.keys(emergency) as (keyof RegistrationForm)[],
  4: Object.keys(medical) as (keyof RegistrationForm)[],
  5: Object.keys(payer) as (keyof RegistrationForm)[],
  6: Object.keys(identification) as (keyof RegistrationForm)[],
  7: Object.keys(consent) as (keyof RegistrationForm)[],
}

// ── legacy quick-add schema (kept for callers that only need name + basics) ──
export const createPatientSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
})

export type CreatePatientInput = z.infer<typeof createPatientSchema>
