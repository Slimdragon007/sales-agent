import {
  PREVIEW_REQUEST_INTENT_HEADER,
  PREVIEW_REQUEST_INTENT_VALUE,
} from "../src/lib/realtime-config";

const PREVIEW_USERNAME = "operator";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(result);
}

async function securelyEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    digest(left),
    digest(right),
  ]);
  let difference = leftDigest.length ^ rightDigest.length;

  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
  }

  return difference === 0;
}

export async function isPreviewAuthorized(
  request: Request,
  expectedPassword: string,
): Promise<boolean> {
  const authorization = request.headers.get("Authorization");

  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const separator = decoded.indexOf(":");

    if (separator < 0) {
      return false;
    }

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    return (
      username === PREVIEW_USERNAME &&
      (await securelyEqual(password, expectedPassword))
    );
  } catch {
    return false;
  }
}

export function unauthorizedResponse(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate":
        'Basic realm="Slim Sales Agent Preview", charset="UTF-8"',
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function isPreviewRequestIntentValid(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  if (
    request.headers.get(PREVIEW_REQUEST_INTENT_HEADER) !==
    PREVIEW_REQUEST_INTENT_VALUE
  ) {
    return false;
  }

  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return false;
  }

  const origin = request.headers.get("Origin");

  return origin === null || origin === new URL(request.url).origin;
}

export function requestIntentRejectedResponse(): Response {
  return Response.json(
    {
      code: "REQUEST_INTENT_INVALID",
      message: "This request did not come from the owner interface.",
    },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
