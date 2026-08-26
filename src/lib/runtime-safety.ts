import { z } from "zod";
import {
  PREVIEW_REQUEST_INTENT_HEADER,
  PREVIEW_REQUEST_INTENT_VALUE,
} from "./realtime-config";
import {
  runtimeSafetySchema,
  type RuntimeSafety,
} from "./runtime-safety-schema";

export { runtimeSafetySchema, type RuntimeSafety };

export const realtimeLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  clientSecret: z.string().min(1),
});

export type RealtimeLease = z.infer<typeof realtimeLeaseSchema>;

export async function fetchRuntimeSafety(): Promise<RuntimeSafety> {
  const response = await fetch("/api/runtime-safety", {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Could not read the local voice safety status.");
  }

  return runtimeSafetySchema.parse(await response.json());
}

export async function createRealtimeLease(): Promise<RealtimeLease> {
  const response = await fetch("/api/realtime/client-secret", {
    method: "POST",
    headers: {
      Accept: "application/json",
      [PREVIEW_REQUEST_INTENT_HEADER]: PREVIEW_REQUEST_INTENT_VALUE,
    },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message = z
      .object({ message: z.string().optional() })
      .safeParse(payload);

    throw new Error(
      message.success && message.data.message
        ? message.data.message
        : "The paid voice safety gate blocked this session.",
    );
  }

  return realtimeLeaseSchema.parse(payload);
}

export async function releaseRealtimeLease(leaseId: string): Promise<void> {
  await fetch("/api/realtime/release", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [PREVIEW_REQUEST_INTENT_HEADER]: PREVIEW_REQUEST_INTENT_VALUE,
    },
    body: JSON.stringify({ leaseId }),
    keepalive: true,
  });
}
