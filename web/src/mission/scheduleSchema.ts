import { z } from 'zod'

export const DateSchema = z.iso.date()
export const ScheduleSchema = z
  .object({
    launchId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,160}$/)
      .nullable()
      .optional(),
    maxSlope: z.number().positive().max(90).nullable().optional(),
    departure: DateSchema,
    landing: DateSchema,
    duration: z.union([z.literal(7), z.literal(14), z.literal(28)]),
  })
  .refine((schedule) => schedule.landing > schedule.departure, {
    path: ['landing'],
    message: 'Landing must follow departure',
  })
