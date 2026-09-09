import type { Tour } from '../types'

/**
 * The laboratory workflow: turn ordered investigations into verified results
 * that flow straight back to the doctor.
 */
export const labWorkflow: Tour = {
  id: 'lab-workflow',
  title: 'The laboratory workflow',
  section: 'Core workflow',
  summary: 'Pick up ordered tests, record results, and send them back to the doctor.',
  steps: [
    {
      id: 'start',
      route: '/dashboard',
      target: '[data-tour="dashboard-widgets"]',
      title: 'Start from the dashboard',
      body: 'Your dashboard shows how many investigations are waiting and which are marked urgent.',
      placement: 'top',
    },
    {
      id: 'go-lab',
      route: '/lab',
      target: '[data-tour="nav-lab"]',
      title: 'The worklist',
      body: 'Everything ordered by a doctor lands on the laboratory worklist. This is your whole job in one screen.',
      placement: 'right',
      permission: 'order:result',
    },
    {
      id: 'statuses',
      route: '/lab',
      target: '[data-tour="lab-worklist"]',
      title: 'Move a test through its stages',
      body: 'Filter by Open, Ordered, In progress or Resulted. Mark a sample "in progress" when you pick it up, then enter the result value, unit, reference range and a flag.',
      placement: 'bottom',
      permission: 'order:result',
    },
    {
      id: 'result-flows-back',
      route: '/lab',
      target: '[data-tour="lab-worklist"]',
      title: 'The result goes back on its own',
      body: 'Once you save a result it appears on the ordering doctor\'s dashboard and in the patient\'s Investigations tab. You never have to chase anyone or re-type it.',
      placement: 'bottom',
      permission: 'order:result',
    },
    {
      id: 'done',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'That is the loop',
      body: 'Doctor orders -> it appears on your worklist -> you result it -> the doctor sees it. Keep the Open tab clear and urgent tests first.',
      placement: 'bottom',
    },
  ],
}
