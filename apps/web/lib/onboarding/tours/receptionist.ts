import type { Tour } from '../types'

/**
 * The front-desk workflow, end to end:
 *   register  ->  find  ->  schedule  ->  check in  ->  take payment
 */
export const receptionistWorkflow: Tour = {
  id: 'receptionist-workflow',
  title: 'The front-desk workflow',
  section: 'Core workflow',
  summary: 'Register a patient, book them in, check them in, and take payment.',
  steps: [
    {
      id: 'start',
      route: '/dashboard',
      target: '[data-tour="dashboard-widgets"]',
      title: 'Start from the dashboard',
      body: 'Your dashboard shows today\'s appointments, patients still to check in, and unpaid bills to collect. It is the running to-do list for the desk.',
      placement: 'top',
    },
    {
      id: 'go-patients',
      route: '/patients',
      target: '[data-tour="nav-patients"]',
      title: 'Step 1 - the patient record',
      body: 'Everything begins with a patient. New face? Register them. Returning? Find their record. Both start here.',
      placement: 'right',
    },
    {
      id: 'register',
      route: '/patients',
      target: '[data-tour="patients-add"]',
      title: 'Register a new patient',
      body: '"Add patient" opens a short wizard - name and contact first (that creates the record and a patient number), then insurance and consent. You can save and finish it later.',
      placement: 'bottom',
    },
    {
      id: 'search',
      route: '/patients',
      target: '[data-tour="patients-search"]',
      title: 'Find a returning patient',
      body: 'Search by name, phone or patient number. Always check here before registering - it stops duplicate records.',
      placement: 'bottom',
    },
    {
      id: 'go-schedule',
      route: '/schedule',
      target: '[data-tour="nav-schedule"]',
      title: 'Step 2 - book the visit',
      body: 'Once the patient exists, give them an appointment. The Schedule is the shared calendar for every doctor.',
      placement: 'right',
    },
    {
      id: 'new-appointment',
      route: '/schedule',
      target: '[data-tour="schedule-new"]',
      title: 'Create an appointment',
      body: 'Pick the patient, the doctor and a time. The calendar greys out hours a doctor is not working and warns about clashes.',
      placement: 'bottom',
    },
    {
      id: 'check-in',
      route: '/schedule',
      target: '[data-tour="schedule-board"]',
      title: 'Step 3 - check the patient in',
      body: 'When the patient arrives, open their appointment on the board and mark them checked in. That moves them into the doctor\'s queue.',
      placement: 'top',
    },
    {
      id: 'go-billing',
      route: '/billing',
      target: '[data-tour="nav-billing"]',
      title: 'Step 4 - take payment',
      body: 'After the consultation the visit has an invoice. Billing is where you collect it.',
      placement: 'right',
      permission: 'invoice:pay',
    },
    {
      id: 'record-payment',
      route: '/billing',
      target: '[data-tour="billing-list"]',
      title: 'Record a payment',
      body: 'Find the invoice, click Pay, enter the amount and method. A receipt number is generated and you can print it. Part-payments are fine - the balance stays on the invoice.',
      placement: 'top',
      permission: 'invoice:pay',
    },
    {
      id: 'done',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'That is the loop',
      body: 'Register -> schedule -> check in -> collect payment. Everything else on the desk is a variation of this. The dashboard tells you what is waiting.',
      placement: 'bottom',
    },
  ],
}
