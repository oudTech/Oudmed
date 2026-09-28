'use client'
import { Reveal } from '@/components/motion/Reveal'
import { Stagger, StaggerItem } from '@/components/motion/Stagger'

// The Figma's footer content ("NXGN Management, LLC", "Mirth Connect
// Training", the Enterprise EHR/PM/Financial Suite hexagon diagram) is
// NextGen Healthcare's real, copyrighted branding and product taxonomy left
// over from whatever the design was traced from - not reproduced here.
// This is Oudmed's own navigation, built from modules that actually exist.
const PRODUCT = ['Patients', 'Scheduling', 'Pharmacy', 'Billing & Claims', 'Reports & Analytics', 'Human Resources', 'Administration']

const LEGAL_LINKS = [
  { label: 'Accessibility', href: '/legal#accessibility' },
  { label: 'Terms of Service', href: '/legal#terms' },
  { label: 'Privacy Policy', href: '/legal#privacy' },
  { label: 'Legal notices', href: '/legal#notices' },
]

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V8c0-.9.25-1.5 1.53-1.5H16.7V3.7C16.4 3.66 15.4 3.57 14.25 3.57c-2.4 0-4.05 1.47-4.05 4.17V9.9H7.5V13h2.7v8h3.3z" />
    </svg>
  )
}
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" />
    </svg>
  )
}
function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.3-.02-3-1.83-3-1.84 0-2.12 1.43-2.12 2.9V21H9z" />
    </svg>
  )
}
function YoutubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M21.6 7.2a2.9 2.9 0 0 0-2.05-2.05C17.9 4.6 12 4.6 12 4.6s-5.9 0-7.55.55A2.9 2.9 0 0 0 2.4 7.2 30 30 0 0 0 1.85 12a30 30 0 0 0 .55 4.8 2.9 2.9 0 0 0 2.05 2.05C6.1 19.4 12 19.4 12 19.4s5.9 0 7.55-.55a2.9 2.9 0 0 0 2.05-2.05A30 30 0 0 0 22.15 12a30 30 0 0 0-.55-4.8zM9.9 15.3V8.7L15.6 12z" />
    </svg>
  )
}
const SOCIAL_ICONS = [FacebookIcon, InstagramIcon, LinkedInIcon, YoutubeIcon]

export function MarketingFooter() {
  return (
    <footer style={{ background: 'linear-gradient(160deg, #05070F 0%, #16335B 100%)' }} className="text-white">
      <Stagger className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10" stagger={0.08}>
        <StaggerItem>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/oudmed-logo-white.svg" alt="Oudmed" width={121} height={25} />
          <p className="text-white/60 text-sm mt-4 max-w-xs">
            Multi-tenant hospital management software - patient records, scheduling, pharmacy, billing and claims in
            one place.
          </p>
        </StaggerItem>
        <StaggerItem>
          <h3 className="font-semibold mb-3">Product</h3>
          <ul className="space-y-2 text-sm text-white/70">
            {PRODUCT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </StaggerItem>
        <StaggerItem>
          <h3 className="font-semibold mb-3">Company</h3>
          <ul className="space-y-2 text-sm text-white/70">
            <li><a href="/about" className="hover:text-white transition">About us</a></li>
            <li><a href="/about#careers" className="hover:text-white transition">Careers</a></li>
            <li><a href="/contact" className="hover:text-white transition">Contact</a></li>
          </ul>
        </StaggerItem>
        <StaggerItem>
          <h3 className="font-semibold mb-3">Get started</h3>
          <ul className="space-y-2 text-sm text-white/70">
            <li><a href="/signup" className="hover:text-white transition">Create a hospital</a></li>
            <li><a href="/login" className="hover:text-white transition">Sign in</a></li>
          </ul>
        </StaggerItem>
      </Stagger>
      <div className="border-t border-white/10">
        <Reveal className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/50">
              <span>© {new Date().getFullYear()} Oudmed. All rights reserved.</span>
              {LEGAL_LINKS.map((l) => (
                <span key={l.href} className="flex items-center gap-3">
                  <span className="text-white/20">|</span>
                  <a href={l.href} className="hover:text-white transition">
                    {l.label}
                  </a>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {SOCIAL_ICONS.map((Icon, i) => (
                <span
                  key={i}
                  title="Coming soon"
                  className="w-8 h-8 rounded-md border border-white/15 flex items-center justify-center text-white/70"
                >
                  <Icon />
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-white/40 mt-4 max-w-2xl">
            Oudmed keeps every hospital&apos;s data isolated at the database level, not just by application logic, so
            your patient records stay private and protected.
          </p>
        </Reveal>
      </div>
    </footer>
  )
}
