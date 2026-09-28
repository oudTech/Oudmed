import { MarketingHeader } from '@/components/marketing/MarketingHeader'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { ContactSection } from '@/components/marketing/ContactSection'
import { Reveal } from '@/components/motion/Reveal'

// Server Component so TURNSTILE_SITE_KEY (deliberately not NEXT_PUBLIC_-
// prefixed) is read server-side and passed down as a prop, rather than
// build-time-baked into the client bundle. See ContactSection.tsx.
export default function ContactPage() {
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? ''

  return (
    <div className="bg-white">
      <div style={{ background: '#F5F6F4' }}>
        <MarketingHeader />
        <Reveal className="max-w-4xl mx-auto px-6 py-20 sm:py-28 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900">Contact Us</h1>
        </Reveal>
      </div>

      <ContactSection turnstileSiteKey={turnstileSiteKey} />

      <MarketingFooter />
    </div>
  )
}
