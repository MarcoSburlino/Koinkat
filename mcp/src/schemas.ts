import { z } from 'zod';

export const id = z.string().min(1).max(200);
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const decimal = z.string().max(80).regex(/^-?\d{1,40}(?:\.\d{1,20})?$/);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Expected a valid calendar date');

export const filterShape = {
  startDate: date.optional(), endDate: date.optional(),
  accountId: id.optional(), categoryId: id.optional(), budgetEventId: id.optional(),
  transactionCurrency: currency.optional(),
  merchant: z.string().min(1).max(200).optional(),
  type: z.enum(['income', 'expense', 'transfer']).optional(),
  status: z.enum(['booked', 'pending']).optional(),
  needsReview: z.boolean().optional(), recurring: z.boolean().optional(),
  minAmount: decimal.optional(), maxAmount: decimal.optional(),
};
export const filtersSchema = z.object(filterShape).strict();
export type Filters = z.infer<typeof filtersSchema>;
export const searchSchema = z.object({
  ...filterShape, limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(100_000).default(0),
}).strict();
export const summarySchema = z.object({
  ...filterShape,
  groupBy: z.enum(['none', 'category', 'merchant', 'account', 'month', 'week']).default('none'),
  currency: currency.optional(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).max(100_000).default(0),
}).strict();
export const calculateSchema = z.object({
  operation: z.enum(['sum', 'subtract', 'multiply', 'divide', 'average', 'percentage_of', 'percentage_change']),
  operands: z.array(z.object({ value: decimal, currency: currency.optional() }).strict()).min(1).max(100),
  decimalPlaces: z.number().int().min(0).max(12).default(2),
}).strict();
export type Calculation = z.infer<typeof calculateSchema>;
