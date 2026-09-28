'use client'
import { m, Variants } from 'framer-motion'

interface SplitTextProps {
  text: string
  by?: 'word' | 'char'
  className?: string
  unitClassName?: string
  stagger?: number
  delayChildren?: number
}

const container: (stagger: number, delayChildren: number) => Variants = (stagger, delayChildren) => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
})

const unit: Variants = {
  hidden: { y: '110%' },
  visible: { y: '0%', transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
}

/**
 * Splits `text` into words or characters and reveals each with a masked
 * vertical-slide, staggered via the parent's `whileInView`. Meant to be used
 * as (or inside) a `Stagger`-driven heading; falls back to plain text for
 * screen readers via `aria-label` on the wrapper + `aria-hidden` on the split
 * spans, so accessibility isn't traded for the effect.
 */
export function SplitText({
  text,
  by = 'word',
  className,
  unitClassName,
  stagger = 0.04,
  delayChildren = 0,
}: SplitTextProps) {
  const units = by === 'word' ? text.split(' ') : text.split('')

  return (
    <m.span
      aria-label={text}
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.6 }}
      variants={container(stagger, delayChildren)}
      style={{ display: 'inline' }}
    >
      {units.map((u, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}
        >
          <m.span variants={unit} className={unitClassName} style={{ display: 'inline-block' }}>
            {u}
            {by === 'word' && i < units.length - 1 ? ' ' : ''}
          </m.span>
        </span>
      ))}
    </m.span>
  )
}
