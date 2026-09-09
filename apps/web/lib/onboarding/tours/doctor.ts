import type { Tour } from '../types'

/**
 * The clinical workflow. Pass 1 tours the entry points and explains how the
 * chart, consultation, prescriptions and lab requests connect; the deep
 * click-through walk of a real consultation is the pass-2 first-task flow.
 */
export const doctorWorkflow: Tour = {
  id: 'doctor-workflow',
  title: 'The consultation workflow',
  section: 'Core workflow',
  summary: 'From today\'s list to diagnosis, prescription and follow-up.',
  steps: [
    {
      id: 'your-day',
      route: '/dashboard',
      target: '[data-tour="dashboard-widgets"]',
      title: 'Your day at a glance',
      body: 'Your dashboard lists the patients booked with you today, anything in progress, and new results that have come back overnight.',
      placement: 'top',
    },
    {
      id: 'go-schedule',
      route: '/schedule',
      target: '[data-tour="nav-schedule"]',
      title: 'The schedule',
      body: 'The full calendar. Checked-in patients are your queue - open one to see the appointment and jump to the patient.',
      placement: 'right',
    },
    {
      id: 'board',
      route: '/schedule',
      target: '[data-tour="schedule-board"]',
      title: 'Open an appointment',
      body: 'Click a patient on the board. From the appointment you can open their full chart or start the consultation directly.',
      placement: 'top',
    },
    {
      id: 'go-patients',
      route: '/patients',
      target: '[data-tour="nav-patients"]',
      title: 'The patient chart',
      body: 'Opening a patient gives you tabbed access to their whole record - complaints, diagnoses, vitals, prescriptions, investigations, documents and past visits. Review the history before you see them.',
      placement: 'right',
    },
    {
      id: 'consultation',
      route: '/patients',
      target: '[data-tour="patients-search"]',
      title: 'The consultation workspace',
      body: 'Open a patient to reach their chart. From a checked-in visit, "Start consultation" gives you one screen for the complaint, vitals, diagnosis, prescription and lab or imaging requests - all stamped to that visit.',
      placement: 'bottom',
    },
    {
      id: 'orders-flow',
      route: '/lab',
      target: '[data-tour="lab-worklist"]',
      title: 'Prescriptions and lab requests',
      body: 'Requests you raise in the consultation land here on the lab worklist, and results come back to your dashboard. Prescriptions reach the pharmacy queue the same way - nothing is re-typed between departments.',
      placement: 'top',
      permission: 'order:result',
    },
    {
      id: 'how-it-connects',
      route: '/dashboard',
      target: '[data-tour="dashboard-greeting"]',
      title: 'How it all connects',
      body: 'Appointment -> check-in -> consultation -> diagnosis -> prescription / lab request -> the invoice builds itself -> follow-up. You work in the middle of that chain; the rest happens around you.',
      placement: 'bottom',
    },
  ],
}
