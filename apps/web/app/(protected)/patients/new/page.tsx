'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { PatientDTO } from '@oudhealth/contracts'
import {
  registrationSchema,
  registrationDefaults,
  REGISTRATION_STEP_FIELDS,
  type RegistrationForm,
} from '@oudhealth/validation'
import { can } from '@/lib/permissions'
import { Field, Input, Select, Textarea, Button } from '@/components/ui/kit'
import {
  patientsApi,
  patientName,
  titleCase,
  MARITAL_STATUS,
  BLOOD_GROUPS,
  RH_FACTORS,
  GENOTYPES,
  PREGNANCY_STATUS,
  ID_DOC_TYPES,
} from '@/lib/patients'
import { COUNTRIES } from '@/lib/countries'
import { trackFirst } from '@/lib/onboarding/analytics'
import { ProviderCombobox } from '@/components/admin/ProviderCombobox'

const STEP_TITLES = [
  '',
  'Find existing record',
  'Personal information',
  'Emergency contact',
  'Medical information',
  'Insurance & payer',
  'Identification',
  'Consent',
  'Review & confirm',
]
const STEP_SUB = [
  '',
  'Check whether this patient is already registered',
  "Basic identification and contact information",
  'Person to contact in an emergency',
  'Clinical and medical history',
  'How this patient will be billed',
  'Photo and government-issued ID (optional)',
  'Treatment and data-processing consent',
  'Confirm the details before finishing',
]

type Form = Record<string, any>

function WizardInner() {
  const router = useRouter()
  const params = useSearchParams()
  const resumeId = params?.get('id') ?? null

  const [step, setStep] = useState(resumeId ? 2 : 1)
  const [patientId, setPatientId] = useState<string | null>(resumeId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const {
    register,
    reset,
    trigger,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: registrationDefaults,
    mode: 'onBlur',
  })

  const payerType = watch('payerType')

  const existing = useQuery({
    queryKey: ['patient', resumeId],
    queryFn: () => patientsApi.get(resumeId!),
    enabled: !!resumeId,
  })

  useEffect(() => {
    if (existing.data) {
      const p = existing.data
      reset({
        ...registrationDefaults,
        firstName: p.firstName, middleName: p.middleName ?? '', lastName: p.lastName,
        gender: p.gender ?? '', dateOfBirth: p.dateOfBirth?.slice(0, 10) ?? '',
        maritalStatus: (p.maritalStatus ?? '') as RegistrationForm['maritalStatus'],
        nationality: p.nationality ?? '',
        occupation: p.occupation ?? '', phone: p.phone ?? '', altPhone: p.altPhone ?? '',
        email: p.email ?? '', address: p.address ?? '', city: p.city ?? '', state: p.state ?? '',
        country: p.country ?? 'NG',
        emergencyContactName: p.emergencyContactName ?? '',
        emergencyContactRelationship: p.emergencyContactRelationship ?? '',
        emergencyContactPhone: p.emergencyContactPhone ?? '',
        emergencyContactAltPhone: p.emergencyContactAltPhone ?? '',
        emergencyContactAddress: p.emergencyContactAddress ?? '',
        bloodGroup: (p.bloodGroup ?? '') as RegistrationForm['bloodGroup'],
        rhFactor: (p.rhFactor ?? '') as RegistrationForm['rhFactor'],
        genotype: (p.genotype ?? '') as RegistrationForm['genotype'],
        allergies: p.allergies ?? '', chronicConditions: p.chronicConditions ?? '',
        currentMedications: p.currentMedications ?? '', previousSurgeries: p.previousSurgeries ?? '',
        disabilities: p.disabilities ?? '',
        pregnancyStatus: (p.pregnancyStatus ?? '') as RegistrationForm['pregnancyStatus'],
        familyHistory: p.familyHistory ?? '',
        heightCm: p.heightCm != null ? String(p.heightCm) : '',
        weightKg: p.weightKg != null ? String(p.weightKg) : '',
        payerType: p.payerType, hmoName: p.hmoName ?? '', hmoNumber: p.hmoNumber ?? '',
        insuranceProvider: p.insuranceProvider ?? '', insuranceNumber: p.insuranceNumber ?? '',
        insurancePlanType: p.insurancePlanType ?? '', insuranceEmployer: p.insuranceEmployer ?? '',
        insuranceExpiry: p.insuranceExpiry?.slice(0, 10) ?? '',
        idDocumentType: (p.idDocumentType ?? '') as RegistrationForm['idDocumentType'],
        idDocumentNumber: p.idDocumentNumber ?? '',
        consentTreatment: !!p.consentTreatment, consentDataProcessing: !!p.consentDataProcessing,
      })
      setStep(Math.min(8, Math.max(2, p.registrationStep)))
    }
  }, [existing.data, reset])

  /** Drops blank / undefined values so a partial step still saves cleanly. */
  function clean(keys: string[]) {
    const values = getValues() as Form
    const out: Form = {}
    for (const k of keys) {
      const v = values[k]
      if (v !== '' && v !== undefined && v !== null) out[k] = v
    }
    return out
  }

  async function save(next: number, finish = false) {
    setError('')
    const stepFields = REGISTRATION_STEP_FIELDS[step] ?? []
    if (stepFields.length && !(await trigger(stepFields as any))) return

    setSaving(true)
    try {
      const payload = clean(stepFields as string[])
      if (step >= 3) payload.reachedStep = Math.max(step, next)
      if (finish) payload.completeRegistration = true

      let id = patientId
      if (!id) {
        const created = await patientsApi.create(clean(REGISTRATION_STEP_FIELDS[2] as string[]))
        id = created.id
        setPatientId(id)
        trackFirst('first_patient_created', { via: 'registration' })
      } else if (Object.keys(payload).length) {
        await patientsApi.update(id, payload)
      }

      if (finish || next > 8) {
        router.replace(`/patients/${id}`)
        return
      }
      setStep(next)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not save. Check the details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* header */}
      <div className="bg-white px-8 py-4 flex items-center justify-between flex-shrink-0 border-b border-[#D6DEE8]">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3366E3" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Patient Registration</h1>
            <p className="text-xs text-gray-400">{STEP_SUB[step]}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 min-w-[220px]">
          <span className="text-sm text-gray-500 whitespace-nowrap">Step {step} of 8</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${(step / 8) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto bg-white border border-gray-100 rounded-2xl p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-1">{STEP_TITLES[step]}</h2>
          <p className="text-sm text-gray-400 mb-6">{STEP_SUB[step]}</p>

          {step === 1 && <StepDedupe onContinue={() => setStep(2)} onPick={(id) => router.replace(`/patients/${id}`)} />}

          {step === 2 && (
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="First name" required error={errors.firstName?.message}><Input {...register('firstName')} /></Field>
              <Field label="Middle name" error={errors.middleName?.message}><Input {...register('middleName')} /></Field>
              <Field label="Last name" required error={errors.lastName?.message}><Input {...register('lastName')} /></Field>
              <Field label="Gender" error={errors.gender?.message}>
                <Select {...register('gender')}>
                  <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
                </Select>
              </Field>
              <Field label="Date of birth" error={errors.dateOfBirth?.message}><Input type="date" {...register('dateOfBirth')} /></Field>
              <Field label="Marital status" error={errors.maritalStatus?.message}>
                <Select {...register('maritalStatus')}>
                  <option value="">Select</option>
                  {MARITAL_STATUS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
                </Select>
              </Field>
              <Field label="Nationality" error={errors.nationality?.message}><Input {...register('nationality')} placeholder="Nigerian" /></Field>
              <Field label="Occupation" error={errors.occupation?.message}><Input {...register('occupation')} /></Field>
              <div />
              <Field label="Phone" error={errors.phone?.message}><Input {...register('phone')} placeholder="080..." /></Field>
              <Field label="Alternative phone" error={errors.altPhone?.message}><Input {...register('altPhone')} /></Field>
              <Field label="Email" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>
              <div className="sm:col-span-3"><Field label="Residential address" error={errors.address?.message}><Input {...register('address')} /></Field></div>
              <Field label="City" error={errors.city?.message}><Input {...register('city')} /></Field>
              <Field label="State" error={errors.state?.message}><Input {...register('state')} /></Field>
              <Field label="Country" error={errors.country?.message}>
                <Select {...register('country')}>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-blue-50/50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-gray-500">
                The emergency contact should be someone who can make medical decisions if the patient cannot.
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Contact name" error={errors.emergencyContactName?.message}><Input {...register('emergencyContactName')} /></Field>
                <Field label="Relationship" error={errors.emergencyContactRelationship?.message}><Input {...register('emergencyContactRelationship')} placeholder="Spouse, parent…" /></Field>
                <Field label="Phone" error={errors.emergencyContactPhone?.message}><Input {...register('emergencyContactPhone')} /></Field>
                <Field label="Alternative phone" error={errors.emergencyContactAltPhone?.message}><Input {...register('emergencyContactAltPhone')} /></Field>
              </div>
              <Field label="Address" error={errors.emergencyContactAddress?.message}><Input {...register('emergencyContactAddress')} /></Field>
            </div>
          )}

          {step === 4 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Blood group" error={errors.bloodGroup?.message}>
                <Select {...register('bloodGroup')}>
                  <option value="">Select</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="Rh factor" error={errors.rhFactor?.message}>
                <Select {...register('rhFactor')}>
                  <option value="">Select</option>{RH_FACTORS.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                </Select>
              </Field>
              <Field label="Genotype" error={errors.genotype?.message}>
                <Select {...register('genotype')}>
                  <option value="">Select</option>{GENOTYPES.map((g) => <option key={g} value={g}>{g}</option>)}
                </Select>
              </Field>
              <Field label="Pregnancy status" error={errors.pregnancyStatus?.message}>
                <Select {...register('pregnancyStatus')}>
                  <option value="">Not applicable</option>
                  {PREGNANCY_STATUS.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
                </Select>
              </Field>
              <Field label="Height (cm)" error={errors.heightCm?.message}><Input type="number" {...register('heightCm')} /></Field>
              <Field label="Weight (kg)" error={errors.weightKg?.message}><Input type="number" {...register('weightKg')} /></Field>
              <div className="sm:col-span-2"><Field label="Known allergies" error={errors.allergies?.message}><Textarea rows={2} {...register('allergies')} placeholder="e.g. Penicillin, peanuts" /></Field></div>
              <div className="sm:col-span-2"><Field label="Existing conditions" error={errors.chronicConditions?.message}><Textarea rows={2} {...register('chronicConditions')} placeholder="e.g. Hypertension, diabetes" /></Field></div>
              <Field label="Current medications" error={errors.currentMedications?.message}><Textarea rows={2} {...register('currentMedications')} /></Field>
              <Field label="Previous surgeries" error={errors.previousSurgeries?.message}><Textarea rows={2} {...register('previousSurgeries')} /></Field>
              <Field label="Disabilities" error={errors.disabilities?.message}><Textarea rows={2} {...register('disabilities')} /></Field>
              <Field label="Family medical history" error={errors.familyHistory?.message}><Textarea rows={2} {...register('familyHistory')} /></Field>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <Field label="Payer type" required error={errors.payerType?.message}>
                <Select {...register('payerType')}>
                  <option value="CASH">Cash / self-pay</option>
                  <option value="HMO">HMO</option>
                  <option value="NHIS">NHIS</option>
                  <option value="RETAINER">Company retainer</option>
                </Select>
              </Field>
              {payerType === 'HMO' && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="HMO name" error={errors.hmoName?.message}>
                    <ProviderCombobox kind="HMO" value={watch('hmoName') ?? ''} onChange={(v) => setValue('hmoName', v, { shouldValidate: true, shouldDirty: true })} />
                  </Field>
                  <Field label="HMO / policy number" error={errors.hmoNumber?.message}><Input {...register('hmoNumber')} /></Field>
                </div>
              )}
              {payerType === 'NHIS' && (
                <Field label="NHIS number" error={errors.hmoNumber?.message}><Input {...register('hmoNumber')} /></Field>
              )}
              {(payerType === 'HMO' || payerType === 'RETAINER') && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Provider / scheme" error={errors.insuranceProvider?.message}>
                    <ProviderCombobox
                      kind={payerType === 'RETAINER' ? 'COMPANY' : undefined}
                      value={watch('insuranceProvider') ?? ''}
                      onChange={(v) => setValue('insuranceProvider', v, { shouldValidate: true, shouldDirty: true })}
                    />
                  </Field>
                  <Field label="Membership number" error={errors.insuranceNumber?.message}><Input {...register('insuranceNumber')} /></Field>
                  <Field label="Plan type" error={errors.insurancePlanType?.message}><Input {...register('insurancePlanType')} /></Field>
                  <Field label="Employer" error={errors.insuranceEmployer?.message}><Input {...register('insuranceEmployer')} /></Field>
                  <Field label="Expiry date" error={errors.insuranceExpiry?.message}><Input type="date" {...register('insuranceExpiry')} /></Field>
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
                Photo &amp; document upload is not enabled yet. Record the ID details below and add
                scans later from the patient&apos;s Documents tab.
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="ID document type" error={errors.idDocumentType?.message}>
                  <Select {...register('idDocumentType')}>
                    <option value="">Select</option>
                    {ID_DOC_TYPES.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
                  </Select>
                </Field>
                <Field label="ID document number" error={errors.idDocumentNumber?.message}><Input {...register('idDocumentNumber')} /></Field>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="space-y-3">
              <label className="flex items-start gap-3 border border-gray-100 rounded-lg p-3 cursor-pointer">
                <input type="checkbox" {...register('consentTreatment')} className="mt-0.5 h-4 w-4 rounded text-primary" />
                <span className="text-sm text-gray-700">
                  <b>Consent to treatment.</b> The patient (or guardian) consents to examination and
                  treatment by this facility&apos;s clinicians.
                </span>
              </label>
              <label className="flex items-start gap-3 border border-gray-100 rounded-lg p-3 cursor-pointer">
                <input type="checkbox" {...register('consentDataProcessing')} className="mt-0.5 h-4 w-4 rounded text-primary" />
                <span className="text-sm text-gray-700">
                  <b>Consent to data processing.</b> Personal and health data may be processed for
                  care, billing and legal requirements, in line with the NDPR.
                </span>
              </label>
            </div>
          )}

          {step === 8 && existing.data && <StepReview patient={existing.data} form={getValues() as Form} />}
          {step === 8 && !existing.data && patientId && <StepReviewLoad id={patientId} form={getValues() as Form} />}

          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          {/* nav */}
          {step > 1 && (
            <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setStep((s) => Math.max(2, s - 1))} disabled={saving}>
                Back
              </Button>
              <div className="flex gap-2">
                {step >= 3 && patientId && (
                  <Button variant="ghost" onClick={() => save(step, false)} disabled={saving}>
                    Save &amp; finish later
                  </Button>
                )}
                {step < 8 ? (
                  <Button onClick={() => save(step + 1)} loading={saving}>
                    Continue
                  </Button>
                ) : (
                  <Button onClick={() => save(8, true)} loading={saving}>
                    Finish registration
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepDedupe({ onContinue, onPick }: { onContinue: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState({ firstName: '', lastName: '', phone: '', dateOfBirth: '' })
  const [checked, setChecked] = useState(false)
  const search = useQuery({
    queryKey: ['dupes', q],
    queryFn: () => patientsApi.checkDuplicates(q),
    enabled: false,
  })
  const run = async () => {
    await search.refetch()
    setChecked(true)
  }
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="First name"><Input value={q.firstName} onChange={(e) => setQ({ ...q, firstName: e.target.value })} /></Field>
        <Field label="Last name"><Input value={q.lastName} onChange={(e) => setQ({ ...q, lastName: e.target.value })} /></Field>
        <Field label="Phone"><Input value={q.phone} onChange={(e) => setQ({ ...q, phone: e.target.value })} /></Field>
        <Field label="Date of birth"><Input type="date" value={q.dateOfBirth} onChange={(e) => setQ({ ...q, dateOfBirth: e.target.value })} /></Field>
      </div>
      <Button variant="secondary" onClick={run} loading={search.isFetching} disabled={!q.lastName && !q.phone}>
        Check for an existing record
      </Button>

      {checked && (
        <div className="border border-gray-100 rounded-xl divide-y">
          {(search.data?.matches ?? []).length === 0 ? (
            <p className="p-3 text-sm text-gray-400">No existing record found.</p>
          ) : (
            search.data!.matches.map((m) => (
              <button key={m.id} onClick={() => onPick(m.id)} className="w-full text-left px-3 py-2.5 hover:bg-blue-50/40">
                <span className="text-sm font-medium text-gray-900">{patientName(m)}</span>
                <span className="text-xs text-gray-400 ml-2">
                  {m.patientNumber} · {m.phone ?? '-'} · {m.age != null ? `${m.age}y` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={onContinue}>This is a new patient - continue</Button>
      </div>
    </div>
  )
}

function StepReviewLoad({ id, form }: { id: string; form: Form }) {
  const p = useQuery({ queryKey: ['patient', id], queryFn: () => patientsApi.get(id) })
  if (!p.data) return <p className="text-sm text-gray-400">Loading…</p>
  return <StepReview patient={p.data} form={form} />
}

function StepReview({ patient, form }: { patient: PatientDTO; form: Form }) {
  const rows: [string, any][] = [
    ['Name', patientName({ firstName: form.firstName ?? patient.firstName, middleName: form.middleName, lastName: form.lastName ?? patient.lastName })],
    ['Patient number', patient.patientNumber],
    ['Date of birth', form.dateOfBirth || (patient.dateOfBirth?.slice(0, 10) ?? '-')],
    ['Gender', form.gender || patient.gender || '-'],
    ['Phone', form.phone || patient.phone || '-'],
    ['Emergency contact', form.emergencyContactName || patient.emergencyContactName || '-'],
    ['Blood group / genotype', `${form.bloodGroup || patient.bloodGroup || '-'} / ${form.genotype || patient.genotype || '-'}`],
    ['Payer', form.payerType || patient.payerType],
    ['Consent', form.consentTreatment && form.consentDataProcessing ? 'Both given' : 'Incomplete'],
  ]
  return (
    <dl className="divide-y divide-gray-100 border border-gray-100 rounded-xl text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-4 px-4 py-2.5">
          <dt className="text-gray-400 w-44 flex-shrink-0">{k}</dt>
          <dd className="text-gray-800 font-medium">{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function NewPatientPage() {
  const { data: session } = useSession()
  if (!can(session?.role, 'patient:register')) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Register patient</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Patient registration is available to clinical and front-desk staff.
        </p>
      </div>
    )
  }
  return (
    <Suspense fallback={null}>
      <WizardInner />
    </Suspense>
  )
}
