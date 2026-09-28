'use client'
import { createContext, useContext, useState, ReactNode } from 'react'

interface CursorContextValue {
  text: string | undefined
  setCursorText: (text: string | undefined) => void
}

const CursorContext = createContext<CursorContextValue | null>(null)

export function CursorProvider({ children }: { children: ReactNode }) {
  const [text, setCursorText] = useState<string | undefined>(undefined)
  return <CursorContext.Provider value={{ text, setCursorText }}>{children}</CursorContext.Provider>
}

/** Lets an element request contextual cursor text while hovered, e.g. onMouseEnter={() => setCursorText('View')}. */
export function useCursor() {
  const ctx = useContext(CursorContext)
  if (!ctx) throw new Error('useCursor must be used within a CursorProvider')
  return ctx
}
