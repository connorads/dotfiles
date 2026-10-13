import { z } from 'zod';

export const ampReadingSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), text: z.string().min(1), observedAt: z.number().nonnegative() }),
  z.object({ status: z.literal('unavailable'), message: z.string() }),
]);
export type AmpReading = z.infer<typeof ampReadingSchema>;

export const ampOverviewSchema = z.object({ machines: z.array(z.object({
  hostId: z.string(), hostName: z.string(), reading: ampReadingSchema, message: z.string().nullable(),
})) });
export type AmpOverview = z.infer<typeof ampOverviewSchema>;
