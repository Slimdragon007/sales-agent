const MAX_LEASE_ID_LENGTH = 128;

export async function readLeaseIdFromRequest(
  request: Request,
): Promise<string | null> {
  try {
    const rawBody = await request.text();

    if (rawBody.trim().length === 0) {
      return null;
    }

    const payload: unknown = JSON.parse(rawBody);

    return typeof payload === "object" &&
      payload !== null &&
      "leaseId" in payload &&
      typeof payload.leaseId === "string" &&
      payload.leaseId.length > 0 &&
      payload.leaseId.length <= MAX_LEASE_ID_LENGTH
      ? payload.leaseId
      : null;
  } catch {
    return null;
  }
}
