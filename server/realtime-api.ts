import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { z } from "zod";
import {
  OPENAI_API_BASE_URL,
  REALTIME_MODEL,
  REALTIME_SAFETY_IDENTIFIER,
  REALTIME_VOICE,
  openAIRealtimeClientSecretSchema,
} from "../src/lib/realtime-config";
import {
  runtimeSafetyConfigSchema,
  type RuntimeSafetyConfig,
} from "../src/lib/runtime-safety-schema";
import {
  evaluateBrowserVoiceLease,
  isBrowserVoiceLeaseExpired,
} from "../src/lib/voice-session-policy";

type SessionLease = {
  id: string;
  expiresAt: number;
};

function getRuntimeSafety(): RuntimeSafetyConfig {
  const configPath = resolve(process.cwd(), "config/runtime-safety.json");
  const contents = readFileSync(configPath, "utf8");
  return runtimeSafetyConfigSchema.parse(JSON.parse(contents));
}

function getUtcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    throw new Error("The request contained an unsupported body chunk.");
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createRealtimeApiPlugin(mode: string): Plugin {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";

  const leases = new Map<string, SessionLease>();
  let dailyCounter = { dateKey: getUtcDateKey(), count: 0 };

  function removeExpiredLeases(now = Date.now()): void {
    for (const [leaseId, lease] of leases) {
      if (isBrowserVoiceLeaseExpired(lease.expiresAt, now)) {
        leases.delete(leaseId);
      }
    }
  }

  function refreshDailyCounter(): void {
    const dateKey = getUtcDateKey();

    if (dailyCounter.dateKey !== dateKey) {
      dailyCounter = { dateKey, count: 0 };
    }
  }

  async function createClientSecret(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== "POST") {
      sendJson(response, 405, { code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const safety = getRuntimeSafety();
    removeExpiredLeases();
    refreshDailyCounter();

    const decision = evaluateBrowserVoiceLease({
      safety,
      snapshot: {
        activeLeaseCount: leases.size,
        dailyPaidTests: dailyCounter.count,
        nowMs: Date.now(),
      },
    });

    if (!decision.allowed) {
      sendJson(response, decision.status, {
        code: decision.code,
        message: decision.message,
      });
      return;
    }

    if (!apiKey) {
      sendJson(response, 503, {
        code: "OPENAI_KEY_MISSING",
        message: "The server does not have an OpenAI API key.",
      });
      return;
    }

    const openAIResponse = await fetch(
      `${OPENAI_API_BASE_URL}/realtime/client_secrets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": REALTIME_SAFETY_IDENTIFIER,
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            audio: {
              output: {
                voice: REALTIME_VOICE,
              },
            },
          },
        }),
      },
    );

    const payload: unknown = await openAIResponse.json();

    if (!openAIResponse.ok) {
      sendJson(response, openAIResponse.status, {
        code: "OPENAI_CLIENT_SECRET_ERROR",
        details: payload,
      });
      return;
    }

    const clientSecret = openAIRealtimeClientSecretSchema.safeParse(payload);

    if (!clientSecret.success) {
      sendJson(response, 502, {
        code: "OPENAI_CLIENT_SECRET_INVALID",
        message: "OpenAI returned an unexpected browser credential format.",
      });
      return;
    }

    const leaseId = randomUUID();
    const expiresAt = decision.expiresAt;

    leases.set(leaseId, { id: leaseId, expiresAt });
    dailyCounter.count += 1;

    sendJson(response, 200, {
      leaseId,
      expiresAt,
      clientSecret: clientSecret.data.value,
    });
  }

  async function releaseLease(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== "POST") {
      sendJson(response, 405, { code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const releaseSchema = z.object({ leaseId: z.string().uuid() });
    const result = releaseSchema.safeParse(await readJsonBody(request));

    if (!result.success) {
      sendJson(response, 400, { code: "INVALID_LEASE" });
      return;
    }

    leases.delete(result.data.leaseId);
    sendJson(response, 200, { released: true });
  }

  return {
    name: "slim-sales-agent-realtime-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");

        if (url.pathname === "/api/runtime-safety") {
          const safety = getRuntimeSafety();
          removeExpiredLeases();
          refreshDailyCounter();
          sendJson(response, 200, {
            ...safety,
            apiKeyConfigured: Boolean(apiKey),
            activeSessions: leases.size,
            paidTestsToday: dailyCounter.count,
            realtimeModel: REALTIME_MODEL,
            phonePilotUsage: {
              activeCalls: 0,
              lifetimeCalls: 0,
              estimatedReservedSpendUsd: 0,
            },
          });
          return;
        }

        if (url.pathname === "/api/realtime/client-secret") {
          void createClientSecret(request, response).catch((error: unknown) => {
            sendJson(response, 500, {
              code: "REALTIME_SERVER_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "An unknown server error occurred.",
            });
          });
          return;
        }

        if (url.pathname === "/api/realtime/release") {
          void releaseLease(request, response).catch((error: unknown) => {
            sendJson(response, 500, {
              code: "LEASE_RELEASE_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "An unknown server error occurred.",
            });
          });
          return;
        }

        next();
      });
    },
  };
}
