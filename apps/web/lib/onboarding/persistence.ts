import { useCallback, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OnboardingState, UserPreferencesDTO } from '@oudhealth/contracts'
import { api } from '@/lib/api'
import { DEFAULT_ONBOARDING } from './types'

const LS_KEY = 'oud.onboarding.v1'
const QK = ['me-preferences'] as const

// ── API wrapper (matches lib/<domain>.ts convention) ──────────────────────────
export const meApi = {
  getPreferences: () =>
    api.get<UserPreferencesDTO>('/me/preferences').then((r) => r.data ?? {}),
  patchPreferences: (patch: UserPreferencesDTO) =>
    api.patch<UserPreferencesDTO>('/me/preferences', patch).then((r) => r.data ?? {}),
}

// ── localStorage write-through cache (instant reads, offline tolerance) ────────
function readLocal(): UserPreferencesDTO | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as UserPreferencesDTO) : null
  } catch {
    return null
  }
}
function writeLocal(prefs: UserPreferencesDTO) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode / quota - server is still the source of truth */
  }
}

/**
 * Server-persisted user preferences with a localStorage cache. Reads resolve
 * instantly from localStorage, then reconcile with the server. Writes update the
 * cache + localStorage optimistically and PATCH the server; a failed PATCH keeps
 * the local value (losing tour progress to a network blip is worse than a stale
 * server row - the next successful write reconciles).
 */
export function usePreferences() {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: QK,
    queryFn: meApi.getPreferences,
    initialData: () => readLocal() ?? undefined,
    staleTime: 30_000,
    retry: 1,
  })

  useEffect(() => {
    if (query.data) writeLocal(query.data)
  }, [query.data])

  const mutation = useMutation({
    mutationFn: meApi.patchPreferences,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: QK })
      const prev = qc.getQueryData<UserPreferencesDTO>(QK) ?? {}
      const next: UserPreferencesDTO = {
        ...prev,
        ...patch,
        onboarding: { ...(prev.onboarding ?? {}), ...(patch.onboarding ?? {}) },
        seenFeatures: patch.seenFeatures ?? prev.seenFeatures,
      }
      qc.setQueryData(QK, next)
      writeLocal(next)
      return { prev }
    },
    onError: () => {
      /* keep the optimistic local value; do not roll back onboarding progress */
    },
    onSuccess: (server) => {
      qc.setQueryData(QK, server)
      writeLocal(server)
    },
  })

  // Stable references while the stored values are unchanged - the onboarding
  // context value is derived from these, and it fans out to every consumer.
  const storedOnboarding = query.data?.onboarding
  const storedSeen = query.data?.seenFeatures
  const onboarding = useMemo(
    () => ({ ...DEFAULT_ONBOARDING, ...(storedOnboarding ?? {}) }),
    [storedOnboarding],
  )
  const seenFeatures = useMemo(() => storedSeen ?? [], [storedSeen])

  const { mutate } = mutation
  const patchOnboarding = useCallback(
    (partial: Partial<OnboardingState>) => mutate({ onboarding: partial }),
    [mutate],
  )
  const markFeatureSeen = useCallback(
    (id: string) => {
      if (seenFeatures.includes(id)) return
      mutate({ seenFeatures: [...seenFeatures, id] })
    },
    [mutate, seenFeatures],
  )

  return {
    ready: !query.isLoading,
    onboarding,
    seenFeatures,
    patchOnboarding,
    markFeatureSeen,
  }
}
