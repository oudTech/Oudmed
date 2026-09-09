'use client'
import { Modal } from '@/components/ui/kit'

export function ChooseActionModal({
  open,
  onClose,
  onAppointment,
  onAdmission,
}: {
  open: boolean
  onClose: () => void
  onAppointment: () => void
  onAdmission: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Choose an action" width={620} align="center">
      <div className="grid grid-cols-2 gap-4 pt-1">
        <ActionCard
          onClick={onAppointment}
          title="Outpatient visit"
          subtitle="Book a consultation or walk-in on a doctor's schedule"
          icon={
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#3366E3" strokeWidth="1.6">
              <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 13v4M10 15h4" strokeLinecap="round" />
            </svg>
          }
        />
        <ActionCard
          onClick={onAdmission}
          title="Inpatient admission"
          subtitle="Admit a patient to a ward and assign a bed"
          icon={
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#3366E3" strokeWidth="1.6">
              <path d="M3 7v11M3 12h13a4 4 0 0 1 4 4v2M3 18h18M7 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
      </div>
    </Modal>
  )
}

function ActionCard({
  onClick,
  title,
  subtitle,
  icon,
}: {
  onClick: () => void
  title: string
  subtitle: string
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-gray-100 bg-gray-50 hover:bg-gray-100 hover:border-gray-200 transition p-6 flex flex-col items-center justify-center gap-3 text-center"
      style={{ minHeight: 200 }}
    >
      {icon}
      <span className="text-sm font-semibold" style={{ color: '#3366E3' }}>
        {title}
      </span>
      <span className="text-xs text-gray-400 leading-snug max-w-[85%]">{subtitle}</span>
    </button>
  )
}
