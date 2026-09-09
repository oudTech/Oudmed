import type { Tour } from '../types'

/**
 * The shared "where is everything" tour. Every step is permission-gated, so each
 * role only sees the modules they can actually use - a pharmacist's version is
 * four steps, a hospital admin's is a dozen. The OnboardingProvider drops any
 * step whose `permission` the current role lacks, and any step whose target is
 * not on the page.
 */
export const gettingAround: Tour = {
  id: 'getting-around',
  title: 'Getting around',
  section: 'Getting around',
  summary: 'A quick lap of the sidebar and the modules you have access to.',
  steps: [
    {
      id: 'sidebar',
      route: '/dashboard',
      target: '[data-tour="sidebar"]',
      title: 'Your sidebar',
      body: 'Every part of the hospital lives here. It only shows the modules your role can open, so you will never hit a dead end.',
      placement: 'right',
    },
    {
      id: 'dashboard',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'Your dashboard',
      body: 'This is your home base. It surfaces what needs your attention right now - today\'s patients, queues, and unfinished work - so you know where to start.',
      placement: 'bottom',
    },
    {
      id: 'nav-schedule',
      target: '[data-tour="nav-schedule"]',
      title: 'Schedule',
      body: 'The appointment calendar. Book visits, move them, check patients in, and see which doctors are on.',
      placement: 'right',
      permission: 'patient:read',
    },
    {
      id: 'nav-patients',
      target: '[data-tour="nav-patients"]',
      title: 'Patients',
      body: 'Register new patients and open any patient\'s full record - history, visits, prescriptions, documents and bills in one place.',
      placement: 'right',
      permission: 'patient:read',
    },
    {
      id: 'nav-wards',
      target: '[data-tour="nav-wards"]',
      title: 'Wards & beds',
      body: 'The live bed board for admitted patients - who is where, and which beds are free.',
      placement: 'right',
      permission: 'patient:read',
    },
    {
      id: 'nav-pharmacy',
      target: '[data-tour="nav-pharmacy"]',
      title: 'Pharmacy',
      body: 'Two jobs in one screen: the dispensing queue for prescriptions, and drug inventory with per-batch stock.',
      placement: 'right',
      permission: 'pharmacy:manage',
    },
    {
      id: 'nav-lab',
      target: '[data-tour="nav-lab"]',
      title: 'Laboratory',
      body: 'The worklist of investigations that have been ordered. Enter and verify results here; they flow straight back to the doctor.',
      placement: 'right',
      permission: 'order:result',
    },
    {
      id: 'nav-billing',
      target: '[data-tour="nav-billing"]',
      title: 'Billing',
      body: 'Every invoice and payment. Record a payment, print a receipt, or build an ad-hoc bill.',
      placement: 'right',
      permission: 'billing:manage',
    },
    {
      id: 'nav-claims',
      target: '[data-tour="nav-claims"]',
      title: 'Claims',
      body: 'Turn HMO visit invoices into claims, batch them per provider, and reconcile remittances as they come in.',
      placement: 'right',
      permission: 'claims:manage',
    },
    {
      id: 'nav-reports',
      target: '[data-tour="nav-reports"]',
      title: 'Reports',
      body: 'Financial and operational figures over any date range, with CSV export for your own analysis.',
      placement: 'right',
      permission: 'reports:view',
    },
    {
      id: 'nav-hr',
      target: '[data-tour="nav-hr"]',
      title: 'Human resources',
      body: 'The staff directory - add users, set roles and departments, activate or deactivate accounts.',
      placement: 'right',
      permission: 'staff:manage',
    },
    {
      id: 'nav-admin',
      target: '[data-tour="nav-admin"]',
      title: 'Administration',
      body: 'Master data the rest of the system draws on: services and prices, departments, and insurance providers.',
      placement: 'right',
      permission: 'admin:settings',
    },
    {
      id: 'help',
      target: '[data-tour="nav-support"]',
      title: 'Help is always here',
      body: 'Stuck later? Open Support to replay any tour, read the getting-started guide, or contact us. You never lose the chance to learn the system.',
      placement: 'right',
    },
  ],
}
