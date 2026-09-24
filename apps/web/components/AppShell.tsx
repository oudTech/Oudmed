'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { can, type Action } from '@/lib/permissions'
import { OnboardingProvider } from '@/components/onboarding'
import { subscriptionsApi } from '@/lib/subscriptions'

/* ─────────────────────────── icons ─────────────────────────── */
const INACTIVE = '#69768F'

function HomeIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  )
}

function ScheduleIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M14.625 14.25L11.25 13.125V8.42087M20.25 12C20.25 7.02944 16.2206 3 11.25 3C6.27944 3 2.25 7.02944 2.25 12C2.25 16.9706 6.27944 21 11.25 21C11.8268 21 12.3909 20.9457 12.9375 20.8421M18.5625 15.375V18.1875M18.5625 18.1875V21M18.5625 18.1875H21.375M18.5625 18.1875H15.75" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function PatientIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 13.5557C14.3722 13.5557 16.4711 14.0084 17.9395 14.6973C19.4872 15.4234 20 16.2289 20 16.7783C19.9998 17.4746 19.6205 18.2354 18.3896 18.877C17.1255 19.5358 15.0584 20 12 20C8.94161 20 6.87454 19.5358 5.61035 18.877C4.37952 18.2354 4.00016 17.4746 4 16.7783C4 16.2289 4.51284 15.4234 6.06055 14.6973C7.52885 14.0084 9.62782 13.5557 12 13.5557ZM12 4C13.484 4 14.8184 5.4463 14.8184 7.00977C14.8183 8.52535 13.5293 9.875 12 9.875C10.4707 9.875 9.1817 8.52535 9.18164 7.00977C9.18164 5.4463 10.516 4 12 4Z" stroke={color} strokeWidth="2"/>
    </svg>
  )
}

function WardIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v11M3 13h13a4 4 0 0 1 4 4v1M3 18h18M7 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  )
}

function PharmacyIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M18.088 16.8638C17.5434 16.9553 17.176 17.471 17.2675 18.0157C17.359 18.5603 17.8747 18.9277 18.4194 18.8362L18.2537 17.85L18.088 16.8638ZM17.0152 11.3824C16.4629 11.3824 16.0152 11.8301 16.0152 12.3824C16.0152 12.9347 16.4629 13.3824 17.0152 13.3824V12.3824V11.3824ZM16.0924 9.28265V10.2827C17.5684 10.2827 18.7646 9.0858 18.7646 7.60999H17.7646H16.7646C16.7646 7.98176 16.4633 8.28265 16.0924 8.28265V9.28265ZM14.4202 7.60999H13.4202C13.4202 9.0858 14.6163 10.2827 16.0924 10.2827V9.28265V8.28265C15.7214 8.28265 15.4202 7.98176 15.4202 7.60999H14.4202ZM16.0924 5.93734V4.93734C14.6163 4.93734 13.4202 6.13419 13.4202 7.60999H14.4202H15.4202C15.4202 7.23823 15.7214 6.93734 16.0924 6.93734V5.93734ZM17.7646 7.60999H18.7646C18.7646 6.13419 17.5684 4.93734 16.0924 4.93734V5.93734V6.93734C16.4633 6.93734 16.7646 7.23823 16.7646 7.60999H17.7646ZM21 15.1641H20C20 15.5763 19.8701 15.9126 19.6161 16.1792C19.3531 16.4551 18.8849 16.73 18.088 16.8638L18.2537 17.85L18.4194 18.8362C19.524 18.6506 20.429 18.225 21.0638 17.5591C21.7075 16.8838 22 16.0369 22 15.1641H21ZM17.0152 12.3824V13.3824C17.9362 13.3824 18.7269 13.6446 19.2605 14.0171C19.7974 14.3919 20 14.8131 20 15.1641H21H22C22 13.9788 21.3105 13.0091 20.4053 12.3771C19.4967 11.7429 18.295 11.3824 17.0152 11.3824V12.3824ZM11.2625 7.42936H10.2625C10.2625 8.46511 9.58382 9.03069 8.89183 9.03069V10.0307V11.0307C10.8184 11.0307 12.2625 9.43497 12.2625 7.42936H11.2625ZM8.89183 10.0307V9.03069C8.19984 9.03069 7.52113 8.46511 7.52113 7.42936H6.52113H5.52113C5.52113 9.43497 6.96521 11.0307 8.89183 11.0307V10.0307ZM6.52113 7.42936H7.52113C7.52113 6.91225 7.69567 6.57237 7.9127 6.36129C8.1359 6.14421 8.4696 6 8.89183 6V5V4C8.00476 4 7.15311 4.31013 6.51827 4.92756C5.87728 5.55099 5.52113 6.42578 5.52113 7.42936H6.52113ZM8.89183 5V6C9.31406 6 9.64776 6.14421 9.87096 6.36129C10.088 6.57237 10.2625 6.91225 10.2625 7.42936H11.2625H12.2625C12.2625 6.42578 11.9064 5.55099 11.2654 4.92756C10.6306 4.31013 9.7789 4 8.89183 4V5ZM15.0703 16.1679H14.0703C14.0703 16.4806 13.9159 16.8937 13.1677 17.2838C12.3865 17.6911 11.0606 18 9.03513 18V19L9.03513 20C11.216 20 12.9076 19.6749 14.0924 19.0572C15.3103 18.4222 16.0703 17.4193 16.0703 16.1679H15.0703ZM9.03513 19V18C7.00965 18 5.68372 17.6911 4.90252 17.2838C4.1544 16.8937 4 16.4806 4 16.1679H3H2C2 17.4193 2.76001 18.4222 3.97789 19.0572C5.16268 19.6749 6.85432 20 9.03513 20L9.03513 19ZM3 16.1679H4C4 16.0022 4.18138 15.545 5.19247 15.0705C6.12422 14.6333 7.48172 14.3357 9.03513 14.3357V13.3357V12.3357C7.25544 12.3357 5.59537 12.6722 4.34283 13.26C3.16963 13.8105 2 14.7695 2 16.1679H3ZM9.03513 13.3357V14.3357C10.5886 14.3357 11.9461 14.6333 12.8778 15.0705C13.8889 15.545 14.0703 16.0022 14.0703 16.1679H15.0703H16.0703C16.0703 14.7695 14.9006 13.8105 13.7274 13.26C12.4749 12.6722 10.8148 12.3357 9.03513 12.3357V13.3357Z" fill={color}/>
    </svg>
  )
}

function LabIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M10 3v6.5L5.2 17.3A2 2 0 0 0 7 20.3h10a2 2 0 0 0 1.8-3L14 9.5V3M8 14h8" />
    </svg>
  )
}

function HRIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M4.8 5.78763L4.35279 4.8932C4.01401 5.06259 3.8 5.40885 3.8 5.78763H4.8ZM12 21.3876L11.466 22.2331C11.7922 22.4391 12.2078 22.4391 12.534 22.2331L12 21.3876ZM19.2 5.78763H20.2C20.2 5.40885 19.986 5.06259 19.6472 4.8932L19.2 5.78763ZM10.39 2.99261L9.94282 2.09818L10.39 2.99261ZM13.61 2.99261L14.0572 2.09818V2.09818L13.61 2.99261ZM14.7 11.8878C15.2523 11.8878 15.7 11.4401 15.7 10.8878C15.7 10.3355 15.2523 9.88777 14.7 9.88777V10.8878V11.8878ZM9.3 9.88777C8.74772 9.88777 8.3 10.3355 8.3 10.8878C8.3 11.4401 8.74772 11.8878 9.3 11.8878V10.8878V9.88777ZM11 13.5876C11 14.1399 11.4477 14.5876 12 14.5876C12.5523 14.5876 13 14.1399 13 13.5876H12H11ZM13 8.18763C13 7.63534 12.5523 7.18763 12 7.18763C11.4477 7.18763 11 7.63534 11 8.18763H12H13ZM10.39 2.99261L9.94282 2.09818L4.35279 4.8932L4.8 5.78763L5.24722 6.68205L10.8372 3.88704L10.39 2.99261ZM4.8 5.78763H3.8V13.8156H4.8H5.8V5.78763H4.8ZM4.8 13.8156H3.8C3.8 15.2951 4.66307 16.6972 5.94384 18.0148C7.24507 19.3535 9.12191 20.7527 11.466 22.2331L12 21.3876L12.534 20.5421C10.2405 19.0937 8.51734 17.793 7.37796 16.6208C6.21814 15.4276 5.8 14.5082 5.8 13.8156H4.8ZM12 21.3876L12.534 22.2331C14.8389 20.7775 16.7279 19.5253 18.0344 18.2616C19.3682 16.9714 20.2 15.5679 20.2 13.8156H19.2H18.2C18.2 14.8353 17.7506 15.7535 16.6438 16.8241C15.5097 17.9211 13.7987 19.069 11.466 20.5421L12 21.3876ZM19.2 13.8156H20.2V5.78763H19.2H18.2V13.8156H19.2ZM19.6472 4.8932L14.0572 2.09818L13.61 2.99261L13.1628 3.88704L18.7528 6.68205L19.2 5.78763L19.6472 4.8932ZM10.39 2.99261L10.8372 3.88704C11.5692 3.52105 12.4308 3.52105 13.1628 3.88704L13.61 2.99261L14.0572 2.09818C12.7622 1.45067 11.2378 1.45067 9.94282 2.09818L10.39 2.99261ZM14.7 10.8878V9.88777H12V10.8878V11.8878H14.7V10.8878ZM12 10.8878V9.88777H9.3V10.8878V11.8878H12V10.8878ZM12 13.5876H13V10.8878H12H11V13.5876H12ZM12 10.8878H13V8.18763H12H11V10.8878H12Z" fill={color}/>
    </svg>
  )
}

function ReportsIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M7.19999 11.4V10.2M12 11.4V9M16.8 11.4V6.6M9.59999 16.2L7.79999 21M16.5936 20.9333L14.4723 16.2664M4.79999 16.2C3.47451 16.2 2.39999 15.1255 2.39999 13.8V5.4C2.39999 4.07452 3.47451 3 4.79999 3H19.2C20.5255 3 21.6 4.07452 21.6 5.4V13.8C21.6 15.1255 20.5255 16.2 19.2 16.2H4.79999Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function BillingIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M17 9V7C17 6.46957 16.7893 5.96086 16.4142 5.58579C16.0391 5.21071 15.5304 5 15 5H5C4.46957 5 3.96086 5.21071 3.58579 5.58579C3.21071 5.96086 3 6.46957 3 7V13C3 13.5304 3.21071 14.0391 3.58579 14.4142C3.96086 14.7893 4.46957 15 5 15H7M9 9H19C20.1046 9 21 9.89543 21 11V17C21 18.1046 20.1046 19 19 19H9C7.89543 19 7 18.1046 7 17V11C7 9.89543 7.89543 9 9 9ZM16 14C16 15.1046 15.1046 16 14 16C12.8954 16 12 15.1046 12 14C12 12.8954 12.8954 12 14 12C15.1046 12 16 12.8954 16 14Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function AdminIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M9.59999 16.2L7.79999 21M16.5936 20.9333L14.4723 16.2664M9.59999 10.2678L11.9457 12.6L14.4 10.1574M11.9457 12.6V6.6M4.79999 16.2C3.47451 16.2 2.39999 15.1255 2.39999 13.8V5.4C2.39999 4.07452 3.47451 3 4.79999 3H19.2C20.5255 3 21.6 4.07452 21.6 5.4V13.8C21.6 15.1255 20.5255 16.2 19.2 16.2H4.79999Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ClaimsIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4" />
      <path d="M7.5 4h9a2 2 0 0 1 2 2v13a1 1 0 0 1-1.5.87L15 19l-2 1-1-1-1 1-2-1-2 .87A1 1 0 0 1 5.5 19V6a2 2 0 0 1 2-2z" />
    </svg>
  )
}

function SupportIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M4.8 5.78738L4.35279 4.89296C4.01401 5.06235 3.8 5.40861 3.8 5.78738H4.8ZM12 21.3874L11.466 22.2329C11.7922 22.4389 12.2078 22.4389 12.534 22.2329L12 21.3874ZM19.2 5.78738H20.2C20.2 5.40861 19.986 5.06235 19.6472 4.89296L19.2 5.78738ZM10.39 2.99237L9.94282 2.09794L10.39 2.99237ZM13.61 2.99237L14.0572 2.09794V2.09794L13.61 2.99237ZM14.7 11.8875C15.2523 11.8875 15.7 11.4398 15.7 10.8875C15.7 10.3352 15.2523 9.88752 14.7 9.88752V10.8875V11.8875ZM9.3 9.88752C8.74772 9.88752 8.3 10.3352 8.3 10.8875C8.3 11.4398 8.74772 11.8875 9.3 11.8875V10.8875V9.88752ZM11 13.5874C11 14.1397 11.4477 14.5874 12 14.5874C12.5523 14.5874 13 14.1397 13 13.5874H12H11ZM13 8.18738C13 7.6351 12.5523 7.18738 12 7.18738C11.4477 7.18738 11 7.6351 11 8.18738H12H13ZM10.39 2.99237L9.94282 2.09794L4.35279 4.89296L4.8 5.78738L5.24722 6.68181L10.8372 3.88679L10.39 2.99237ZM4.8 5.78738H3.8V13.8154H4.8H5.8V5.78738H4.8ZM4.8 13.8154H3.8C3.8 15.2949 4.66307 16.697 5.94384 18.0146C7.24507 19.3532 9.12191 20.7525 11.466 22.2329L12 21.3874L12.534 20.5419C10.2405 19.0935 8.51734 17.7927 7.37796 16.6206C6.21814 15.4274 5.8 14.5079 5.8 13.8154H4.8ZM12 21.3874L12.534 22.2329C14.8389 20.7772 16.7279 19.5251 18.0344 18.2613C19.3682 16.9711 20.2 15.5677 20.2 13.8154H19.2H18.2C18.2 14.8351 17.7506 15.7532 16.6438 16.8238C15.5097 17.9209 13.7987 19.0687 11.466 20.5419L12 21.3874ZM19.2 13.8154H20.2V5.78738H19.2H18.2V13.8154H19.2ZM19.6472 4.89296L14.0572 2.09794L13.61 2.99237L13.1628 3.88679L18.7528 6.68181L19.2 5.78738L19.6472 4.89296ZM10.39 2.99237L10.8372 3.88679C11.5692 3.52081 12.4308 3.52081 13.1628 3.88679L13.61 2.99237L14.0572 2.09794C12.7622 1.45043 11.2378 1.45043 9.94282 2.09794L10.39 2.99237ZM14.7 10.8875V9.88752H12V10.8875V11.8875H14.7V10.8875ZM12 10.8875V9.88752H9.3V10.8875V11.8875H12V10.8875ZM12 13.5874H13V10.8875H12H11V13.5874H12ZM12 10.8875H13V8.18738H12H11V10.8875H12Z" fill={color}/>
    </svg>
  )
}

function SettingsIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

/* ─────────────────────────── nav config ─────────────────────── */
const MAIN_NAV: {
  href: string
  label: string
  Icon: (p: { color?: string }) => JSX.Element
  action?: Action
}[] = [
  { href: '/dashboard', label: 'Dashboard',        Icon: HomeIcon     },
  { href: '/schedule',  label: 'Schedule',        Icon: ScheduleIcon, action: 'patient:read' },
  { href: '/patients',  label: 'Patient',          Icon: PatientIcon, action: 'patient:read' },
  { href: '/wards',     label: 'Wards & Beds',     Icon: WardIcon,    action: 'patient:read' },
  { href: '/pharmacy',  label: 'Pharmacy',         Icon: PharmacyIcon, action: 'pharmacy:manage' },
  { href: '/lab',       label: 'Laboratory',       Icon: LabIcon,     action: 'order:result' },
  { href: '/hr',        label: 'Human resources',  Icon: HRIcon       },
  { href: '/reports',   label: 'Reports',          Icon: ReportsIcon  },
  { href: '/billing',   label: 'Billing',          Icon: BillingIcon, action: 'billing:manage' },
  { href: '/claims',    label: 'Claims',           Icon: ClaimsIcon   },
  { href: '/admin',     label: 'Administration',   Icon: AdminIcon    },
]

const BOTTOM_NAV = [
  { href: '/support',  label: 'Support',  Icon: SupportIcon  },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon },
]

/**
 * Proactive - only shown to the one role that can actually act on it
 * (/subscriptions/me itself is gated to admin:settings). Everyone else only
 * learns about a subscription problem reactively, if they hit a blocked
 * write - see SubscriptionReadOnlyListener in Providers.tsx.
 */
function SubscriptionBanner({ canSeeIt }: { canSeeIt: boolean }) {
  const q = useQuery({ queryKey: ['subscription-me'], queryFn: subscriptionsApi.getMine, enabled: canSeeIt })
  if (!q.data) return null
  const { accessLevel, status, trialDaysRemaining } = q.data

  if (accessLevel === 'READ_ONLY') {
    return (
      <div className="bg-red-50 border-b border-red-100 px-6 py-2 text-sm text-red-700 flex items-center justify-between flex-shrink-0">
        <span>This hospital&apos;s subscription needs attention - new records cannot be created until billing is updated.</span>
        <Link href="/settings" className="font-semibold underline flex-shrink-0 ml-3">Update billing</Link>
      </div>
    )
  }
  if (status === 'TRIALING' && trialDaysRemaining !== null && trialDaysRemaining <= 3) {
    return (
      <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 text-sm text-blue-700 flex items-center justify-between flex-shrink-0">
        <span>
          {trialDaysRemaining === 0 ? 'Your trial ends today.' : `${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left in your trial.`}
        </span>
        <Link href="/settings" className="font-semibold underline flex-shrink-0 ml-3">Set up billing</Link>
      </div>
    )
  }
  return null
}

/* ─────────────────────────── component ─────────────────────── */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const pathname = usePathname() ?? ''

  const tenant = (session as any)?.tenant
  const primary = tenant?.primaryColor ?? '#3366E3'
  const [collapsed, setCollapsed] = useState(false)
  const canSeeBilling = can(session?.role, 'admin:settings')

  return (
    <OnboardingProvider>
      <div className="h-screen flex overflow-hidden font-hanken bg-gray-50">

      {/* ── Sidebar ── */}
      <aside
        data-tour="sidebar"
        className={`${collapsed ? 'w-[64px]' : 'w-[208px]'} flex flex-col flex-shrink-0 transition-all duration-200`}
        style={{ backgroundColor: '#F5F7FB', borderRight: '1px solid #D6DEE8' }}
      >

        {/* Logo / hospital name */}
        <div className="px-5 pt-5 pb-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {tenant?.logoUrl ? (
              <Image
                src={tenant.logoUrl}
                alt={tenant.name ?? 'Logo'}
                width={30} height={30}
                unoptimized
                className="rounded-lg object-contain flex-shrink-0"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: primary }}
              >
                {(tenant?.name ?? 'O').charAt(0).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <span className="text-sm font-bold truncate" style={{ color: primary }}>
                {tenant?.name ?? 'Oudmed'}
              </span>
            )}
          </div>
          <button
            className="flex-shrink-0 hover:opacity-70 transition"
            title="Toggle sidebar"
            onClick={() => setCollapsed((c) => !c)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10.2611 14.1714C10.5616 14.532 11.0976 14.5807 11.4582 14.2802C11.8188 13.9797 11.8676 13.4437 11.567 13.083L10.914 13.6272L10.2611 14.1714ZM7.59946 9.64969L6.94647 9.10554C6.68379 9.42076 6.68379 9.87863 6.94647 10.1939L7.59946 9.64969ZM11.567 6.21635C11.8676 5.85571 11.8188 5.31973 11.4582 5.0192C11.0976 4.71867 10.5616 4.7674 10.2611 5.12803L10.914 5.67219L11.567 6.21635ZM10.914 13.6272L11.567 13.083L8.25244 9.10554L7.59946 9.64969L6.94647 10.1939L10.2611 14.1714L10.914 13.6272ZM7.59946 9.64969L8.25244 10.1939L11.567 6.21635L10.914 5.67219L10.2611 5.12803L6.94647 9.10554L7.59946 9.64969ZM9.85001 0.850098V1.7001C14.3511 1.7001 18 5.34898 18 9.8501H18.85H19.7C19.7 4.41009 15.29 9.7394e-05 9.85001 9.76324e-05V0.850098ZM18.85 9.8501H18C18 14.3512 14.3511 18.0001 9.85001 18.0001V18.8501V19.7001C15.29 19.7001 19.7 15.2901 19.7 9.8501H18.85ZM9.85001 18.8501V18.0001C5.34889 18.0001 1.70001 14.3512 1.70001 9.8501H0.850006H6.07967e-06C6.31809e-06 15.2901 4.41 19.7001 9.85001 19.7001V18.8501ZM0.850006 9.8501H1.70001C1.70001 5.34898 5.34888 1.7001 9.85001 1.7001V0.850098V9.76324e-05C4.41 9.78708e-05 5.84126e-06 4.41009 6.07967e-06 9.8501H0.850006Z" fill="#69768F"/>
            </svg>
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {MAIN_NAV.filter((item) => !item.action || can(session?.role, item.action)).map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                data-tour={`nav-${href.slice(1).replace(/\//g, '-')}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active ? 'bg-white shadow-sm' : 'hover:bg-black/5'}`}
                style={{ color: active ? '#111827' : INACTIVE }}
              >
                <Icon color={active ? primary : INACTIVE} />
                {!collapsed && (
                  <span className={active ? 'font-semibold' : 'font-medium'}>{label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Bottom navigation */}
        <div className="px-3 py-4 border-t border-black/10 space-y-0.5">
          {BOTTOM_NAV.map(({ href, label, Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                data-tour={`nav-${href.slice(1).replace(/\//g, '-')}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active ? 'bg-white shadow-sm' : 'hover:bg-black/5'}`}
                style={{ color: active ? '#111827' : INACTIVE }}
              >
                <Icon color={active ? primary : INACTIVE} />
                {!collapsed && (
                  <span className={active ? 'font-semibold' : 'font-medium'}>{label}</span>
                )}
              </Link>
            )
          })}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SubscriptionBanner canSeeIt={canSeeBilling} />
        {children}
      </div>
      </div>
    </OnboardingProvider>
  )
}
