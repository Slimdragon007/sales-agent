import { z } from "zod";

export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const REALTIME_MODEL = "gpt-realtime-2.1";
export const REALTIME_VOICE = "marin";
export const REALTIME_SAFETY_IDENTIFIER =
  "0efb1e8b45ee785d2e8f1d8725b36b649fdc440df1e9334c80e64c581b7de540";
export const PREVIEW_REQUEST_INTENT_HEADER = "X-Slim-Request-Intent";
export const PREVIEW_REQUEST_INTENT_VALUE = "owner-ui-v1";

export const openAIRealtimeClientSecretSchema = z.object({
  value: z.string().min(1),
});
