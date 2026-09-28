'use client'
import { m, Variants } from 'framer-motion'
import { ReactNode } from 'react'

interface StaggerProps {
  children: ReactNode
  className?: string
  stagger?: number
  delayChildren?: number
  once?: boolean
  amount?: number
}

/** Parent timeline for a group of `StaggerItem`s - reveals children in sequence on scroll into view. */
export function Stagger({
  children,
  className,
  stagger = 0.08,
  delayChildren = 0,
  once = true,
  amount = 0.2,
}: StaggerProps) {
  const container: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  }

  return (
    <m.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount }}
      variants={container}
    >
      {children}
    </m.div>
  )
}

interface StaggerItemProps {
  children: ReactNode
  className?: string
  distance?: number
  duration?: number
}

/** A single child of `Stagger` - inherits the parent's timeline via Framer's variant propagation. */
export function StaggerItem({ children, className, distance = 24, duration = 0.6 }: StaggerItemProps) {
  const item: Variants = {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0, transition: { duration, ease: [0.16, 1, 0.3, 1] } },
  }

  return (
    <m.div className={className} variants={item}>
      {children}
    </m.div>
  )
}
