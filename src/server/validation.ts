import { z } from "zod";

export const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024)
});

export const catalogDownloadSchema = z.object({
  eventId: z.string().regex(/^(?:p\d+|s\d+-m\d+)$/)
});

export const catalogRefreshSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("seasons") }),
  z.object({ scope: z.literal("events"), id: z.string().regex(/^\d+$/) }),
  z.object({ scope: z.literal("sessions"), id: z.string().regex(/^(?:p\d+|s\d+-m\d+)$/) })
]);
