# Onboarding & guided tours

A role-aware welcome + guided-tour system for the HMS web app. It teaches
**workflows** ("here is how you get your job done"), not a tooltip on every
button. Purely an `apps/web` feature plus one additive API endpoint
(`GET/PATCH /api/me/preferences`) for per-user progress.

## How it fits together

```
lib/onboarding/
  types.ts          TourStep / Tour / OnboardingState
  analytics.ts      track() dev-console sink + trackFirst() milestone guard
  persistence.ts    usePreferences() - react-query + localStorage write-through
  tours/
    getting-around.ts     shared orientation, permission-filtered per step (ALL roles)
    receptionist.ts doctor.ts admin.ts    workflow tours
    index.ts              registry: toursForRole(role) / tourById(role, id)

components/onboarding/
  OnboardingProvider.tsx   orchestrator - mounted inside <AppShell>
  Spotlight.tsx            dimmed overlay with a cut-out around the target
  TourPopover.tsx          the anchored card (Back / Next / Skip / Finish)
  TourProgress.tsx         "Step 3 of 8" + SectionProgress for the Help Center
  WelcomeModal.tsx         first-login prompt
  EmptyState.tsx           helpful empty state for high-traffic lists
  FeatureCallout.tsx       one-time "New" note + useFeatureDiscovery(id)
  index.ts                 barrel
```

`OnboardingProvider` is mounted once, inside `AppShell`, so it is protected-only
and has session + query + feedback context. It renders its overlays through
portals, so it never interferes with page layout. Any thrown error ends the tour
and leaves the app untouched.

State (`{ status, currentTour, currentStep, completedTours, skippedTours }` +
`seenFeatures`) lives in `User.preferences` (JSONB) via `/api/me/preferences`,
with `localStorage['oud.onboarding.v1']` as a write-through cache for instant
reads and offline tolerance. Never put tour state in the NextAuth session - it is
JWT-cached and re-bootstrapped.

## Add a step to an existing tour

1. Pick or add a stable anchor on the page: `data-tour="patients-search"` on the
   element itself (a `data-*` attribute, never a CSS-structural selector).
2. Add a `TourStep` to the tour's `steps` array:

   ```ts
   {
     id: 'search',                       // stable within the tour (analytics + resume)
     route: '/patients',                 // navigated to first if not already there
     target: '[data-tour="patients-search"]',
     title: 'Find anyone fast',
     body: 'Search by name, patient number or HMO number. Use this before you register someone new so you do not create a duplicate.',
     placement: 'bottom',                // optional hint; auto-flips if it would clip
     permission: 'patient:read',         // optional - step removed when !can(role, permission)
     optional: true,                     // optional - skip silently if the target never appears
   }
   ```

Bodies say **what it is and why it matters** in one or two plain sentences. No
"click the blue button" narration.

## Add a whole tour

1. Create `lib/onboarding/tours/<name>.ts` exporting a `Tour`
   (`id`, `title`, `section`, `summary`, `steps`).
2. Register it in `lib/onboarding/tours/index.ts` `BY_ROLE` for the roles that
   should get it, in the order they should run.
3. The Help Center (`/support`) picks it up automatically from `availableTours`,
   and `finish()` offers the next uncompleted tour in the list.

## Add an anchor to a new page

Just add `data-tour="<id>"` to the element. If the tour navigates to that route,
set `route` on the step; the provider pushes the route, waits for the path, then
waits (MutationObserver, 5s) for the element before spotlighting it. A missing
target logs a warning, fires `onboarding_step_skipped`, and the tour continues.

## Roles

Roles come from `session.role` / `lib/permissions.ts` (`can(role, action)`).
Every role gets `getting-around` plus one role-specific workflow tour
(`receptionist` / `doctor` / `admin` / `nurse` / `pharmacist` / `lab` /
`accountant`; SUPER_ADMIN reuses `admin`). A step's `permission` gates it per
role, so a tour never points at something the user cannot use.

## Analytics & milestones

`track(event, props)` is a dev-console sink with one documented extension point.
`trackFirst(event)` fires a milestone once per browser (localStorage-guarded) -
used for `first_patient_created`, `first_appointment_created`,
`first_consultation_completed` from the relevant mutation success handlers.
`milestoneReached(event)` reads those flags back; `FirstRunChecklist` (on the
dashboard, Receptionist + Doctor) uses them to tick off first-session tasks and
hides itself once they are all done or dismissed.

## Empty states

`<EmptyState>` is applied to `/patients`, `/schedule`, `/lab`, `/wards` and
`/billing` - the high-traffic lists a new user is most likely to hit while
empty. It is not on every list; add it where "0 rows" is a teachable moment, not
just an error.
