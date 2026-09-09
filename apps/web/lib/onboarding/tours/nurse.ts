import type { Tour } from '../types'

/**
 * The ward / floor workflow: who is coming in, prepping them for the doctor,
 * and keeping the inpatient picture current.
 */
export const nurseWorkflow: Tour = {
  id: 'nurse-workflow',
  title: 'The ward workflow',
  section: 'Core workflow',
  summary: 'Check patients in, record vitals, and keep the bed board current.',
  steps: [
    {
      id: 'start',
      route: '/dashboard',
      target: '[data-tour="dashboard-widgets"]',
      title: 'Start from the dashboard',
      body: 'Your dashboard pulls together today\'s appointments, admitted patients, and anything that needs a nurse before the doctor sees it.',
      placement: 'top',
    },
    {
      id: 'go-schedule',
      route: '/schedule',
      target: '[data-tour="nav-schedule"]',
      title: 'Step 1 - the arrivals',
      body: 'The schedule is the shared calendar. When a booked patient arrives you check them in from here, which moves them into the doctor\'s queue.',
      placement: 'right',
    },
    {
      id: 'board',
      route: '/schedule',
      target: '[data-tour="schedule-board"]',
      title: 'Check a patient in',
      body: 'Open the appointment on the board and mark the patient checked in. You can also book or reschedule a visit from here if the desk is busy.',
      placement: 'top',
    },
    {
      id: 'go-patients',
      route: '/patients',
      target: '[data-tour="nav-patients"]',
      title: 'Step 2 - prep for the doctor',
      body: 'Open the patient to reach their chart. Record vitals and the presenting complaint against the visit so the doctor starts with a full picture.',
      placement: 'right',
    },
    {
      id: 'find-patient',
      route: '/patients',
      target: '[data-tour="patients-search"]',
      title: 'Find the patient fast',
      body: 'Search by name, phone or patient number. Inside the chart, the Vitals and Complaints tabs are where your observations go.',
      placement: 'bottom',
    },
    {
      id: 'go-wards',
      route: '/wards',
      target: '[data-tour="nav-wards"]',
      title: 'Step 3 - the inpatients',
      body: 'Wards & Beds is the live picture of who is admitted and which beds are free.',
      placement: 'right',
    },
    {
      id: 'ward-board',
      route: '/wards',
      target: '[data-tour="wards-board"]',
      title: 'Admit, move and discharge',
      body: 'Admit into a free bed, open an occupied one to see the admission, or change a bed\'s status. The totals up here update as you go.',
      placement: 'bottom',
    },
    {
      id: 'done',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'That is the loop',
      body: 'Check in -> vitals and complaint -> hand to the doctor -> keep the ward board honest. The dashboard tells you what is still waiting.',
      placement: 'bottom',
    },
  ],
}
