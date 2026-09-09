import type { Tour } from '../types'

/**
 * The revenue-cycle workflow: from the day's takings, through HMO claims, to
 * the figures that explain the month.
 */
export const accountantWorkflow: Tour = {
  id: 'accountant-workflow',
  title: 'The revenue-cycle workflow',
  section: 'Core workflow',
  summary: 'Reconcile payments, run HMO claims, and read the month from Reports.',
  steps: [
    {
      id: 'start',
      route: '/dashboard',
      target: '[data-tour="dashboard-widgets"]',
      title: 'Start from the dashboard',
      body: 'Your dashboard leads with the money view: today\'s collections, outstanding balances, and HMO receivables.',
      placement: 'top',
    },
    {
      id: 'go-billing',
      route: '/billing',
      target: '[data-tour="nav-billing"]',
      title: 'Step 1 - reconcile billing',
      body: 'Every invoice and payment in the hospital. Each completed visit already has an invoice; you record payments, print receipts, reverse mistakes, or build an ad-hoc bill.',
      placement: 'right',
      permission: 'billing:manage',
    },
    {
      id: 'billing-list',
      route: '/billing',
      target: '[data-tour="billing-list"]',
      title: 'The day, totalled',
      body: 'Filter by status, category and date range - the footer totals the amount, paid and balance for whatever you have filtered to. That is your daily reconciliation.',
      placement: 'top',
      permission: 'billing:manage',
    },
    {
      id: 'go-claims',
      route: '/claims',
      target: '[data-tour="nav-claims"]',
      title: 'Step 2 - the HMO cycle',
      body: 'Turn HMO visit invoices into claims, batch them per provider, export the schedule, then record remittances against them as payment comes in.',
      placement: 'right',
      permission: 'claims:manage',
    },
    {
      id: 'claims-tabs',
      route: '/claims',
      target: '[data-tour="claims-main"]',
      title: 'Claims, Batches, Remittances, Receivables',
      body: 'The tabs follow the cycle left to right. Recording a remittance posts real payments onto the underlying invoices and ages what is still owed on Receivables.',
      placement: 'bottom',
      permission: 'claims:manage',
    },
    {
      id: 'go-reports',
      route: '/reports',
      target: '[data-tour="nav-reports"]',
      title: 'Step 3 - read the month',
      body: 'Reports aggregates collections, revenue by department and doctor, and the payment ledger - over any date range, exportable to CSV for your own analysis.',
      placement: 'right',
      permission: 'reports:view',
    },
    {
      id: 'reports-range',
      route: '/reports',
      target: '[data-tour="reports-range"]',
      title: 'Pick the period',
      body: 'Change the range here and every figure and chart on the page follows. The payment ledger at the bottom is filterable and exports to a spreadsheet.',
      placement: 'bottom',
      permission: 'reports:view',
    },
    {
      id: 'done',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'That is the cycle',
      body: 'Collect and reconcile in Billing -> claim and chase HMOs in Claims -> explain the result in Reports. The dashboard is the daily snapshot of all three.',
      placement: 'bottom',
    },
  ],
}
