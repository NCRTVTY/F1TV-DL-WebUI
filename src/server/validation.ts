import { z } from "zod";

const f1tvUrl = z.string().trim().url().max(2048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && url.hostname.toLowerCase() === "f1tv.formula1.com"
    && url.pathname.toLowerCase().includes("/detail/");
}, "Enter a valid F1 TV session URL");

export const createJobSchema = z.object({
  url: f1tvUrl,
  quality: z.enum(["best", "1920x1080", "1280x720", "854x480"]).default("best"),
  audio: z.enum(["eng", "nld", "deu", "fra", "por", "spa"]).default("eng"),
  channel: z.string().trim().min(1).max(80).optional()
});

export const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024)
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
