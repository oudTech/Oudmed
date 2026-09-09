import { z } from 'zod'

export const invoiceLineSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  unitPrice: z.number().positive('Unit price must be positive'),
})

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  lines: z.array(invoiceLineSchema).min(1, 'At least one line item is required'),
})

export const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['CASH', 'CARD', 'TRANSFER', 'HMO']),
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>
