'use client'

const NO_KNOWN_ALLERGIES = /^(none|none known|no known allergies|nka|nil)\.?$/i

/** Patient-safety display, read-only - no blocking logic, just putting
 * what's on the chart in front of whoever is about to hand over a drug
 * without making them go check the chart separately. */
export function AllergyBadge({ allergies, inline = false }: { allergies: string | null; inline?: boolean }) {
  const text = allergies?.trim() ?? ''
  const className = inline ? 'text-xs font-semibold' : 'text-xs font-semibold mt-0.5 block'

  if (!text) {
    return <span className={`${className} text-gray-400`}>Allergies not recorded</span>
  }
  if (NO_KNOWN_ALLERGIES.test(text)) {
    return <span className={`${className} text-emerald-700`}>No known allergies</span>
  }
  return <span className={`${className} text-red-700`}>Allergies: {text}</span>
}
