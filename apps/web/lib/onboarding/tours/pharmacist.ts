import type { Tour } from '../types'

/**
 * The dispensing workflow: work the queue the doctors feed you, and keep the
 * catalogue and stock accurate so prescribing stays honest.
 */
export const pharmacistWorkflow: Tour = {
  id: 'pharmacist-workflow',
  title: 'The dispensing workflow',
  section: 'Core workflow',
  summary: 'Work the prescription queue and keep drug stock accurate.',
  steps: [
    {
      id: 'start',
      route: '/dashboard',
      target: '[data-tour="dashboard-widgets"]',
      title: 'Start from the dashboard',
      body: 'Your dashboard shows prescriptions waiting to be dispensed and any drugs running low on stock.',
      placement: 'top',
    },
    {
      id: 'go-pharmacy',
      route: '/pharmacy',
      target: '[data-tour="nav-pharmacy"]',
      title: 'The pharmacy workspace',
      body: 'One screen, two jobs: the Dispensing queue that doctors feed, and the drug Inventory behind it.',
      placement: 'right',
      permission: 'pharmacy:manage',
    },
    {
      id: 'queue',
      route: '/pharmacy',
      target: '[data-tour="pharmacy-tabs"]',
      title: 'The Dispensing queue',
      body: 'Each row on Dispensing is a prescription from a consultation. Confirming a dispense decrements stock from the earliest-expiring batch first and posts the charge to the visit\'s invoice - no re-keying.',
      placement: 'bottom',
      permission: 'pharmacy:manage',
    },
    {
      id: 'inventory',
      route: '/pharmacy',
      target: '[data-tour="pharmacy-tabs"]',
      title: 'The Inventory behind it',
      body: 'The Inventory tab holds the catalogue, batches with expiry dates, and a CSV price-list import. Accurate stock here is what keeps prescribing and dispensing reliable.',
      placement: 'bottom',
      permission: 'pharmacy:manage',
    },
    {
      id: 'done',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'That is the loop',
      body: 'Doctors prescribe -> it lands in your queue -> you dispense -> stock and the invoice update themselves. Your job is the queue and the shelf behind it.',
      placement: 'bottom',
    },
  ],
}
