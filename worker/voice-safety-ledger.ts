import { DurableObject } from "cloudflare:workers";
import {
  PROVIDER_NONTERMINAL_STATES,
  SIP_CLAIMABLE_STATES,
  type PhoneCallLifecycleState,
} from "./phone-call-lifecycle";
import { contactsAfterSeed } from "./phone-contacts-seed";
import type { PhoneContact } from "./phone-destination";
import {
  evaluateVoiceSafetyReservation,
  summarizeVoiceSafetyUsage,
  type VoiceSafetyDecision,
  type VoiceSafetyPolicy,
  type VoiceSafetyScope,
  type VoiceSafetyUsage,
  type VoiceSessionRecord,
  type VoiceSessionStatus,
} from "./safety-policy";

type LedgerEnv = Record<string, never>;

type StoredVoiceSession = {
  id: string;
  scope: VoiceSafetyScope;
  started_at: number;
  expires_at: number;
  status: VoiceSessionStatus;
  reserved_usd_cents: number;
  provider_nonterminal: number;
};

type StoredPhoneCall = {
  lease_id: string;
  call_sid: string;
  status: string;
  updated_at: number;
};

type StoredCurrentPhoneCall = {
  lease_id: string;
  expires_at: number;
  lifecycle_state: PhoneCallLifecycleState;
  call_sid: string | null;
  status: string | null;
  attempted_destination_number: string | null;
  updated_at: number;
};

type StoredPhoneCallObjective = {
  call_objective: string;
};

type StoredPhoneContact = {
  id: string;
  display_name: string;
  e164: string;
};

type StoredPhoneCallHistory = {
  id: string;
  lease_id: string;
  contact_id: string | null;
  display_name: string;
  e164: string;
  objective: string;
  status: string;
  outcome: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number | null;
  summary: string | null;
  transcript_status: string;
  provider_call_sid: string | null;
  updated_at: number;
};

export type PhoneCallRecord = {
  leaseId: string;
  callSid: string;
  status: string;
  updatedAt: number;
};

export type CurrentPhoneCallRecord = {
  leaseId: string;
  expiresAt: number;
  lifecycleState: PhoneCallLifecycleState;
  callSid: string | null;
  status: string | null;
  attemptedDestinationNumber: string | null;
  updatedAt: number;
};

export type PhoneDncSource = "recipient_request" | "owner";

export type PhoneCallHistoryInput = {
  id?: string;
  leaseId: string;
  contactId: string | null;
  displayName: string;
  e164: string;
  objective: string;
  status: string;
  outcome: string;
  startedAt: number;
  endedAt?: number | null;
  durationSeconds?: number | null;
  summary?: string | null;
  transcriptStatus?: string;
  providerCallSid?: string | null;
  updatedAt?: number;
};

export type PhoneCallHistoryUpdate = {
  status?: string;
  outcome?: string;
  endedAt?: number | null;
  durationSeconds?: number | null;
  summary?: string | null;
  transcriptStatus?: string;
  providerCallSid?: string | null;
};

export type PhoneCallHistoryRecord = {
  id: string;
  leaseId: string;
  contactId: string | null;
  displayName: string;
  e164: string;
  objective: string;
  status: string;
  outcome: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  summary: string | null;
  transcriptStatus: string;
  providerCallSid: string | null;
  updatedAt: number;
};

export type VoiceSafetyReservation =
  | {
      allowed: true;
      leaseId: string;
      expiresAt: number;
      usage: VoiceSafetyUsage;
    }
  | Exclude<VoiceSafetyDecision, { allowed: true }>;

const PROVIDER_NONTERMINAL_SQL = PROVIDER_NONTERMINAL_STATES.map(
  () => "?",
).join(", ");

const SIP_CLAIMABLE_SQL = SIP_CLAIMABLE_STATES.map(() => "?").join(", ");

export const PHONE_CONTACT_MAX = 20;

function phoneContactFromRow(row: StoredPhoneContact): PhoneContact {
  return {
    id: row.id,
    displayName: row.display_name,
    e164: row.e164,
  };
}

function phoneCallHistoryFromRow(
  row: StoredPhoneCallHistory,
): PhoneCallHistoryRecord {
  return {
    id: row.id,
    leaseId: row.lease_id,
    contactId: row.contact_id,
    displayName: row.display_name,
    e164: row.e164,
    objective: row.objective,
    status: row.status,
    outcome: row.outcome,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    summary: row.summary,
    transcriptStatus: row.transcript_status,
    providerCallSid: row.provider_call_sid,
    updatedAt: row.updated_at,
  };
}

export class VoiceSafetyLedger extends DurableObject<LedgerEnv> {
  constructor(ctx: DurableObjectState, env: LedgerEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('active', 'released', 'cancelled', 'expired')),
          reserved_usd_cents INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_voice_sessions_scope
          ON voice_sessions(scope);
        CREATE TABLE IF NOT EXISTS phone_calls (
          lease_id TEXT PRIMARY KEY,
          call_sid TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (lease_id) REFERENCES voice_sessions(id)
        );
        CREATE TABLE IF NOT EXISTS phone_call_objectives (
          lease_id TEXT PRIMARY KEY,
          call_objective TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (lease_id) REFERENCES voice_sessions(id)
        );
        CREATE TABLE IF NOT EXISTS phone_call_lifecycle (
          lease_id TEXT PRIMARY KEY,
          state TEXT NOT NULL
            CHECK (
              state IN (
                'reserved',
                'create_pending',
                'provider_unknown',
                'provider_attached',
                'sip_claimed',
                'provider_active',
                'stopping',
                'terminal'
              )
            ),
          sip_claim_token TEXT UNIQUE NOT NULL,
          openai_call_id TEXT UNIQUE,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (lease_id) REFERENCES voice_sessions(id)
        );
        CREATE TABLE IF NOT EXISTS owner_contacts (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          e164 TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS phone_dnc (
          e164 TEXT PRIMARY KEY,
          source TEXT NOT NULL CHECK (source IN ('recipient_request', 'owner')),
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS phone_call_history (
          id TEXT PRIMARY KEY,
          lease_id TEXT NOT NULL UNIQUE,
          contact_id TEXT,
          display_name TEXT NOT NULL,
          e164 TEXT NOT NULL,
          objective TEXT NOT NULL,
          status TEXT NOT NULL,
          outcome TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          duration_seconds INTEGER,
          summary TEXT,
          transcript_status TEXT NOT NULL DEFAULT 'none',
          provider_call_sid TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_phone_call_history_started
          ON phone_call_history(started_at DESC);
        CREATE TABLE IF NOT EXISTS google_oauth_tokens (
          id TEXT PRIMARY KEY,
          refresh_token TEXT NOT NULL,
          access_token TEXT,
          access_expires_at INTEGER,
          scope TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS google_oauth_states (
          state TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);

      ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO phone_call_lifecycle (
          lease_id,
          state,
          sip_claim_token,
          openai_call_id,
          updated_at
        )
        SELECT
          lease_id,
          CASE
            WHEN status IN (
              'busy',
              'canceled',
              'completed',
              'failed',
              'no-answer'
            ) THEN 'terminal'
            ELSE 'provider_unknown'
          END,
          'legacy:' || lease_id,
          NULL,
          updated_at
        FROM phone_calls
      `);
      ctx.storage.sql.exec(`
        UPDATE voice_sessions
        SET status = 'released'
        WHERE scope = 'phone'
          AND status = 'active'
          AND id IN (
            SELECT lease_id
            FROM phone_call_lifecycle
            WHERE state = 'terminal'
          )
      `);

      return Promise.resolve();
    });
  }

  private expireSessions(now: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE voice_sessions
       SET status = 'expired'
       WHERE status = 'active'
         AND expires_at <= ?
         AND NOT EXISTS (
           SELECT 1
           FROM phone_call_lifecycle
           WHERE phone_call_lifecycle.lease_id = voice_sessions.id
             AND phone_call_lifecycle.state IN (
               ${PROVIDER_NONTERMINAL_SQL}
             )
         )`,
      now,
      ...PROVIDER_NONTERMINAL_STATES,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM phone_call_objectives
       WHERE lease_id IN (
         SELECT id
         FROM voice_sessions
         WHERE status != 'active'
       )`,
    );
  }

  private listSessions(): VoiceSessionRecord[] {
    return this.ctx.storage.sql
      .exec<StoredVoiceSession>(
        `SELECT
           voice_sessions.id,
           voice_sessions.scope,
           voice_sessions.started_at,
           voice_sessions.expires_at,
           voice_sessions.status,
           voice_sessions.reserved_usd_cents,
           CASE
             WHEN phone_call_lifecycle.state IN (
               ${PROVIDER_NONTERMINAL_SQL}
             ) THEN 1
             ELSE 0
           END AS provider_nonterminal
         FROM voice_sessions
         LEFT JOIN phone_call_lifecycle
           ON phone_call_lifecycle.lease_id = voice_sessions.id`,
        ...PROVIDER_NONTERMINAL_STATES,
      )
      .toArray()
      .map((session) => ({
        id: session.id,
        scope: session.scope,
        startedAt: session.started_at,
        expiresAt: session.expires_at,
        status: session.status,
        reservedUsdCents: session.reserved_usd_cents,
        providerNonterminal: session.provider_nonterminal === 1,
      }));
  }

  reserveSession(
    scope: VoiceSafetyScope,
    policy: VoiceSafetyPolicy,
    now = Date.now(),
  ): VoiceSafetyReservation {
    this.expireSessions(now);
    const decision = evaluateVoiceSafetyReservation(
      this.listSessions(),
      scope,
      policy,
      now,
    );

    if (!decision.allowed) {
      return decision;
    }

    const leaseId = crypto.randomUUID();

    this.ctx.storage.sql.exec(
      `INSERT INTO voice_sessions (
         id, scope, started_at, expires_at, status, reserved_usd_cents
       ) VALUES (?, ?, ?, ?, 'active', ?)`,
      leaseId,
      scope,
      now,
      decision.expiresAt,
      policy.reservedUsdCentsPerSession,
    );

    return {
      ...decision,
      leaseId,
    };
  }

  releaseSession(
    leaseId: string,
    expectedScope: VoiceSafetyScope,
    now = Date.now(),
  ): boolean {
    this.expireSessions(now);
    const result = this.ctx.storage.sql.exec(
      `UPDATE voice_sessions
       SET status = 'released'
       WHERE id = ?
         AND scope = ?
         AND status = 'active'
         AND (
           scope != 'phone'
           OR EXISTS (
             SELECT 1
             FROM phone_call_lifecycle
             WHERE phone_call_lifecycle.lease_id = voice_sessions.id
               AND phone_call_lifecycle.state = 'terminal'
           )
         )`,
      leaseId,
      expectedScope,
    );

    if (result.rowsWritten > 0) {
      this.deletePhoneCallObjective(leaseId);
    }

    return result.rowsWritten > 0;
  }

  cancelSession(leaseId: string, expectedScope: VoiceSafetyScope): boolean {
    const result = this.ctx.storage.sql.exec(
      `UPDATE voice_sessions
       SET status = 'cancelled'
       WHERE id = ?
         AND scope = ?
         AND status = 'active'
         AND NOT EXISTS (
           SELECT 1
           FROM phone_call_lifecycle
           WHERE phone_call_lifecycle.lease_id = voice_sessions.id
             AND phone_call_lifecycle.state != 'reserved'
         )`,
      leaseId,
      expectedScope,
    );

    if (result.rowsWritten > 0) {
      this.deletePhoneCallObjective(leaseId);
      this.ctx.storage.sql.exec(
        `DELETE FROM phone_call_lifecycle
         WHERE lease_id = ? AND state = 'reserved'`,
        leaseId,
      );
    }

    return result.rowsWritten > 0;
  }

  preparePhoneCall(
    leaseId: string,
    callObjective: string,
    now = Date.now(),
  ): string | null {
    this.expireSessions(now);

    return this.ctx.storage.transactionSync(() => {
      const activeSession = this.ctx.storage.sql
        .exec<{ total: number }>(
          `SELECT COUNT(*) AS total
           FROM voice_sessions
           WHERE id = ?
             AND scope = 'phone'
             AND status = 'active'
             AND expires_at > ?`,
          leaseId,
          now,
        )
        .toArray()[0]?.total;

      if (activeSession !== 1) {
        return null;
      }

      const claimToken = crypto.randomUUID();
      const lifecycle = this.ctx.storage.sql
        .exec<{ sip_claim_token: string }>(
          `INSERT INTO phone_call_lifecycle (
           lease_id, state, sip_claim_token, openai_call_id, updated_at
         ) VALUES (?, 'reserved', ?, NULL, ?)
         RETURNING sip_claim_token`,
          leaseId,
          claimToken,
          now,
        )
        .toArray()[0];

      if (lifecycle?.sip_claim_token !== claimToken) {
        throw new Error("Phone call lifecycle reservation failed.");
      }

      const objective = this.ctx.storage.sql
        .exec<{ lease_id: string }>(
          `INSERT INTO phone_call_objectives (
           lease_id, call_objective, created_at
         ) VALUES (?, ?, ?)
         RETURNING lease_id`,
          leaseId,
          callObjective,
          now,
        )
        .toArray()[0];

      if (objective?.lease_id !== leaseId) {
        throw new Error("Phone call objective reservation failed.");
      }

      return claimToken;
    });
  }

  beginPhoneProviderCreate(leaseId: string, now = Date.now()): boolean {
    this.expireSessions(now);
    const result = this.ctx.storage.sql.exec(
      `UPDATE phone_call_lifecycle
       SET state = 'create_pending', updated_at = ?
       WHERE lease_id = ?
         AND state = 'reserved'
         AND EXISTS (
           SELECT 1
           FROM voice_sessions
           WHERE voice_sessions.id = phone_call_lifecycle.lease_id
             AND voice_sessions.scope = 'phone'
             AND voice_sessions.status = 'active'
             AND voice_sessions.expires_at > ?
         )`,
      now,
      leaseId,
      now,
    );

    return result.rowsWritten > 0;
  }

  markPhoneProviderUnknown(leaseId: string, now = Date.now()): boolean {
    const result = this.ctx.storage.sql.exec(
      `UPDATE phone_call_lifecycle
       SET state = 'provider_unknown', updated_at = ?
       WHERE lease_id = ?
         AND state IN ('create_pending', 'provider_attached')`,
      now,
      leaseId,
    );

    return result.rowsWritten > 0;
  }

  claimPhoneCallObjective(
    leaseId: string,
    claimToken: string,
    openAiCallId: string,
    now = Date.now(),
  ): string | null {
    this.expireSessions(now);

    return this.ctx.storage.transactionSync(() => {
      const claimed = this.ctx.storage.sql
        .exec<{ lease_id: string }>(
          `UPDATE phone_call_lifecycle
           SET
             state = 'sip_claimed',
             openai_call_id = ?,
             updated_at = ?
           WHERE lease_id = ?
             AND sip_claim_token = ?
             AND openai_call_id IS NULL
             AND state IN (${SIP_CLAIMABLE_SQL})
             AND EXISTS (
               SELECT 1
               FROM voice_sessions
               WHERE voice_sessions.id = phone_call_lifecycle.lease_id
                 AND voice_sessions.scope = 'phone'
                 AND voice_sessions.status = 'active'
             )
             AND EXISTS (
               SELECT 1
               FROM phone_call_objectives
               WHERE phone_call_objectives.lease_id =
                 phone_call_lifecycle.lease_id
             )
           RETURNING lease_id`,
          openAiCallId,
          now,
          leaseId,
          claimToken,
          ...SIP_CLAIMABLE_STATES,
        )
        .toArray()[0];

      if (claimed?.lease_id !== leaseId) {
        return null;
      }

      const objective = this.ctx.storage.sql
        .exec<StoredPhoneCallObjective>(
          `DELETE FROM phone_call_objectives
           WHERE lease_id = ?
           RETURNING call_objective`,
          leaseId,
        )
        .toArray()[0]?.call_objective;

      if (!objective) {
        throw new Error(
          "SIP claim consumed a lease without a stored call objective.",
        );
      }

      return objective;
    });
  }

  /**
   * When SIP custom headers are unavailable, claim the sole active phone lease.
   * Safe under phonePilot.maxConcurrentCalls = 1 and signed OpenAI webhooks.
   */
  claimSoleActivePhoneCallObjective(
    openAiCallId: string,
    now = Date.now(),
  ): { leaseId: string; callObjective: string } | null {
    this.expireSessions(now);

    return this.ctx.storage.transactionSync(() => {
      const candidates = this.ctx.storage.sql
        .exec<{ lease_id: string }>(
          `SELECT phone_call_lifecycle.lease_id AS lease_id
           FROM phone_call_lifecycle
           INNER JOIN voice_sessions
             ON voice_sessions.id = phone_call_lifecycle.lease_id
           INNER JOIN phone_call_objectives
             ON phone_call_objectives.lease_id = phone_call_lifecycle.lease_id
           WHERE voice_sessions.scope = 'phone'
             AND voice_sessions.status = 'active'
             AND phone_call_lifecycle.openai_call_id IS NULL
             AND phone_call_lifecycle.state IN (${SIP_CLAIMABLE_SQL})
           ORDER BY voice_sessions.started_at DESC
           LIMIT 2`,
          ...SIP_CLAIMABLE_STATES,
        )
        .toArray();

      if (candidates.length !== 1) {
        return null;
      }

      const leaseId = candidates[0]?.lease_id;

      if (!leaseId) {
        return null;
      }

      const claimed = this.ctx.storage.sql
        .exec<{ lease_id: string }>(
          `UPDATE phone_call_lifecycle
           SET
             state = 'sip_claimed',
             openai_call_id = ?,
             updated_at = ?
           WHERE lease_id = ?
             AND openai_call_id IS NULL
             AND state IN (${SIP_CLAIMABLE_SQL})
           RETURNING lease_id`,
          openAiCallId,
          now,
          leaseId,
          ...SIP_CLAIMABLE_STATES,
        )
        .toArray()[0];

      if (claimed?.lease_id !== leaseId) {
        return null;
      }

      const callObjective = this.ctx.storage.sql
        .exec<StoredPhoneCallObjective>(
          `DELETE FROM phone_call_objectives
           WHERE lease_id = ?
           RETURNING call_objective`,
          leaseId,
        )
        .toArray()[0]?.call_objective;

      if (!callObjective) {
        throw new Error(
          "SIP sole-active claim consumed a lease without a stored call objective.",
        );
      }

      return { leaseId, callObjective };
    });
  }

  recordSipWebhookDiagnostic(
    diagnostic: {
      receivedAt: number;
      signatureOk: boolean;
      eventType: string | null;
      hasWebhookIdHeader: boolean;
      hasLeaseHeader: boolean;
      hasClaimHeader: boolean;
      sipHeaderCount: number;
      claimMode: "headers" | "sole_active" | "rejected" | "skipped";
      accepted: boolean;
      detail: string | null;
    },
  ): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sip_webhook_diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at INTEGER NOT NULL,
        signature_ok INTEGER NOT NULL,
        event_type TEXT,
        has_webhook_id_header INTEGER NOT NULL,
        has_lease_header INTEGER NOT NULL,
        has_claim_header INTEGER NOT NULL,
        sip_header_count INTEGER NOT NULL,
        claim_mode TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        detail TEXT
      );
    `);
    this.ctx.storage.sql.exec(
      `INSERT INTO sip_webhook_diagnostics (
         received_at, signature_ok, event_type, has_webhook_id_header,
         has_lease_header, has_claim_header, sip_header_count,
         claim_mode, accepted, detail
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      diagnostic.receivedAt,
      diagnostic.signatureOk ? 1 : 0,
      diagnostic.eventType,
      diagnostic.hasWebhookIdHeader ? 1 : 0,
      diagnostic.hasLeaseHeader ? 1 : 0,
      diagnostic.hasClaimHeader ? 1 : 0,
      diagnostic.sipHeaderCount,
      diagnostic.claimMode,
      diagnostic.accepted ? 1 : 0,
      diagnostic.detail,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM sip_webhook_diagnostics
       WHERE id NOT IN (
         SELECT id FROM sip_webhook_diagnostics
         ORDER BY received_at DESC, id DESC
         LIMIT 20
       )`,
    );
  }

  listSipWebhookDiagnostics(limit = 10): Array<{
    receivedAt: number;
    signatureOk: boolean;
    eventType: string | null;
    hasWebhookIdHeader: boolean;
    hasLeaseHeader: boolean;
    hasClaimHeader: boolean;
    sipHeaderCount: number;
    claimMode: string;
    accepted: boolean;
    detail: string | null;
  }> {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sip_webhook_diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at INTEGER NOT NULL,
        signature_ok INTEGER NOT NULL,
        event_type TEXT,
        has_webhook_id_header INTEGER NOT NULL,
        has_lease_header INTEGER NOT NULL,
        has_claim_header INTEGER NOT NULL,
        sip_header_count INTEGER NOT NULL,
        claim_mode TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        detail TEXT
      );
    `);

    return this.ctx.storage.sql
      .exec<{
        received_at: number;
        signature_ok: number;
        event_type: string | null;
        has_webhook_id_header: number;
        has_lease_header: number;
        has_claim_header: number;
        sip_header_count: number;
        claim_mode: string;
        accepted: number;
        detail: string | null;
      }>(
        `SELECT received_at, signature_ok, event_type, has_webhook_id_header,
                has_lease_header, has_claim_header, sip_header_count,
                claim_mode, accepted, detail
         FROM sip_webhook_diagnostics
         ORDER BY received_at DESC, id DESC
         LIMIT ?`,
        Math.min(Math.max(limit, 1), 20),
      )
      .toArray()
      .map((row) => ({
        receivedAt: row.received_at,
        signatureOk: row.signature_ok === 1,
        eventType: row.event_type,
        hasWebhookIdHeader: row.has_webhook_id_header === 1,
        hasLeaseHeader: row.has_lease_header === 1,
        hasClaimHeader: row.has_claim_header === 1,
        sipHeaderCount: row.sip_header_count,
        claimMode: row.claim_mode,
        accepted: row.accepted === 1,
        detail: row.detail,
      }));
  }

  private deletePhoneCallObjective(leaseId: string): boolean {
    const result = this.ctx.storage.sql.exec(
      `DELETE FROM phone_call_objectives WHERE lease_id = ?`,
      leaseId,
    );

    return result.rowsWritten > 0;
  }

  isSessionActive(
    leaseId: string,
    scope: VoiceSafetyScope,
    now = Date.now(),
  ): boolean {
    this.expireSessions(now);
    const rows = this.ctx.storage.sql
      .exec<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM voice_sessions
         LEFT JOIN phone_call_lifecycle
           ON phone_call_lifecycle.lease_id = voice_sessions.id
         WHERE voice_sessions.id = ?
           AND voice_sessions.scope = ?
           AND voice_sessions.status = 'active'
           AND (
             voice_sessions.expires_at > ?
             OR phone_call_lifecycle.state IN (
               ${PROVIDER_NONTERMINAL_SQL}
             )
           )`,
        leaseId,
        scope,
        now,
        ...PROVIDER_NONTERMINAL_STATES,
      )
      .toArray();

    return rows[0]?.total === 1;
  }

  attachPhoneCall(
    leaseId: string,
    callSid: string,
    status: string,
    now = Date.now(),
  ): boolean {
    this.expireSessions(now);
    const sessionActive = this.ctx.storage.sql
      .exec<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM voice_sessions
         WHERE id = ?
           AND scope = 'phone'
           AND status = 'active'`,
        leaseId,
      )
      .toArray()[0]?.total;

    if (sessionActive !== 1) {
      return false;
    }

    const attached = this.ctx.storage.sql.exec(
      `UPDATE phone_call_lifecycle
       SET
         state = CASE
           WHEN state = 'sip_claimed' THEN state
           ELSE 'provider_attached'
         END,
         updated_at = ?
       WHERE lease_id = ?
         AND state IN (
           'create_pending',
           'provider_unknown',
           'sip_claimed'
         )`,
      now,
      leaseId,
    );

    if (attached.rowsWritten !== 1) {
      return false;
    }

    const result = this.ctx.storage.sql.exec(
      `INSERT INTO phone_calls (lease_id, call_sid, status, updated_at)
       VALUES (?, ?, ?, ?)`,
      leaseId,
      callSid,
      status,
      now,
    );

    return result.rowsWritten > 0;
  }

  getPhoneCall(leaseId: string): PhoneCallRecord | null {
    const row = this.ctx.storage.sql
      .exec<StoredPhoneCall>(
        `SELECT lease_id, call_sid, status, updated_at
         FROM phone_calls
         WHERE lease_id = ?`,
        leaseId,
      )
      .toArray()[0];

    return row
      ? {
          leaseId: row.lease_id,
          callSid: row.call_sid,
          status: row.status,
          updatedAt: row.updated_at,
        }
      : null;
  }

  getCurrentPhoneCall(now = Date.now()): CurrentPhoneCallRecord | null {
    this.expireSessions(now);
    const row = this.ctx.storage.sql
      .exec<StoredCurrentPhoneCall>(
        `SELECT
           voice_sessions.id AS lease_id,
           voice_sessions.expires_at,
           phone_call_lifecycle.state AS lifecycle_state,
           phone_calls.call_sid,
           phone_calls.status,
           phone_call_history.e164 AS attempted_destination_number,
           phone_call_lifecycle.updated_at
         FROM voice_sessions
         INNER JOIN phone_call_lifecycle
           ON phone_call_lifecycle.lease_id = voice_sessions.id
         LEFT JOIN phone_calls
           ON phone_calls.lease_id = voice_sessions.id
         LEFT JOIN phone_call_history
           ON phone_call_history.lease_id = voice_sessions.id
         WHERE voice_sessions.scope = 'phone'
           AND voice_sessions.status = 'active'
           AND phone_call_lifecycle.state IN (
             ${PROVIDER_NONTERMINAL_SQL}
           )
         ORDER BY voice_sessions.started_at DESC
         LIMIT 1`,
        ...PROVIDER_NONTERMINAL_STATES,
      )
      .toArray()[0];

    return row
      ? {
          leaseId: row.lease_id,
          expiresAt: row.expires_at,
          lifecycleState: row.lifecycle_state,
          callSid: row.call_sid,
          status: row.status,
          attemptedDestinationNumber: row.attempted_destination_number,
          updatedAt: row.updated_at,
        }
      : null;
  }

  updatePhoneCallStatus(
    leaseId: string,
    status: string,
    now = Date.now(),
  ): boolean {
    const call = this.ctx.storage.sql.exec(
      `UPDATE phone_calls
       SET status = ?, updated_at = ?
       WHERE lease_id = ?
         AND EXISTS (
           SELECT 1
           FROM phone_call_lifecycle
           WHERE phone_call_lifecycle.lease_id = phone_calls.lease_id
             AND phone_call_lifecycle.state IN (
               'provider_attached',
               'sip_claimed',
               'provider_active',
               'stopping'
             )
         )`,
      status,
      now,
      leaseId,
    );
    const lifecycle = this.ctx.storage.sql.exec(
      `UPDATE phone_call_lifecycle
       SET
         state = CASE
           WHEN state = 'stopping' THEN state
           ELSE 'provider_active'
         END,
         updated_at = ?
       WHERE lease_id = ?
         AND state IN (
           'provider_attached',
           'sip_claimed',
           'provider_active',
           'stopping'
         )`,
      now,
      leaseId,
    );

    return call.rowsWritten > 0 && lifecycle.rowsWritten > 0;
  }

  beginPhoneCallStop(leaseId: string, now = Date.now()): boolean {
    const result = this.ctx.storage.sql.exec(
      `UPDATE phone_call_lifecycle
       SET state = 'stopping', updated_at = ?
       WHERE lease_id = ?
         AND state IN (
           'provider_attached',
           'sip_claimed',
           'provider_active',
           'stopping'
         )
         AND EXISTS (
           SELECT 1
           FROM phone_calls
           WHERE phone_calls.lease_id = phone_call_lifecycle.lease_id
         )`,
      now,
      leaseId,
    );

    return result.rowsWritten > 0;
  }

  markPhoneCallTerminal(
    leaseId: string,
    status: string,
    now = Date.now(),
  ): boolean {
    this.ctx.storage.sql.exec(
      `UPDATE phone_calls
       SET status = ?, updated_at = ?
       WHERE lease_id = ?`,
      status,
      now,
      leaseId,
    );
    const lifecycle = this.ctx.storage.sql.exec(
      `UPDATE phone_call_lifecycle
       SET state = 'terminal', updated_at = ?
       WHERE lease_id = ?
         AND state != 'terminal'`,
      now,
      leaseId,
    );

    if (lifecycle.rowsWritten === 0) {
      return false;
    }

    this.deletePhoneCallObjective(leaseId);
    const session = this.ctx.storage.sql.exec(
      `UPDATE voice_sessions
       SET status = 'released'
       WHERE id = ?
         AND scope = 'phone'
         AND status = 'active'`,
      leaseId,
    );

    return session.rowsWritten > 0;
  }

  listContacts(): PhoneContact[] {
    return this.ctx.storage.sql
      .exec<StoredPhoneContact>(
        `SELECT id, display_name, e164
         FROM owner_contacts
         ORDER BY display_name COLLATE NOCASE ASC, id ASC`,
      )
      .toArray()
      .map(phoneContactFromRow);
  }

  upsertContact(contact: PhoneContact, now = Date.now()): void {
    this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ total: number }>(
          `SELECT COUNT(*) AS total
           FROM owner_contacts
           WHERE id = ?`,
          contact.id,
        )
        .toArray()[0]?.total;

      if (existing !== 1) {
        const contactCount = this.ctx.storage.sql
          .exec<{ total: number }>(
            `SELECT COUNT(*) AS total FROM owner_contacts`,
          )
          .toArray()[0]?.total;

        if ((contactCount ?? 0) >= PHONE_CONTACT_MAX) {
          throw new Error(`Phone contact limit is ${PHONE_CONTACT_MAX}.`);
        }
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO owner_contacts (
           id, display_name, e164, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           e164 = excluded.e164,
           updated_at = excluded.updated_at`,
        contact.id,
        contact.displayName,
        contact.e164,
        now,
        now,
      );
    });
  }

  deleteContact(id: string): boolean {
    const result = this.ctx.storage.sql.exec(
      `DELETE FROM owner_contacts WHERE id = ?`,
      id,
    );

    return result.rowsWritten > 0;
  }

  ensureSeedContact(seed: PhoneContact): PhoneContact[] {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.listContacts();
      const seeded = contactsAfterSeed(existing, seed);

      if (seeded.length === existing.length) {
        return existing;
      }

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO owner_contacts (
           id, display_name, e164, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
        seed.id,
        seed.displayName,
        seed.e164,
        now,
        now,
      );

      return this.listContacts();
    });
  }

  listDncE164(): string[] {
    return this.ctx.storage.sql
      .exec<{ e164: string }>(
        `SELECT e164
         FROM phone_dnc
         ORDER BY e164 ASC`,
      )
      .toArray()
      .map((row) => row.e164);
  }

  addDnc(e164: string, source: PhoneDncSource, now = Date.now()): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO phone_dnc (e164, source, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(e164) DO UPDATE SET
         source = excluded.source`,
      e164,
      source,
      now,
    );
  }

  isDnc(e164: string): boolean {
    const total = this.ctx.storage.sql
      .exec<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM phone_dnc
         WHERE e164 = ?`,
        e164,
      )
      .toArray()[0]?.total;

    return total === 1;
  }

  recordCallHistory(
    record: PhoneCallHistoryInput,
    now = Date.now(),
  ): PhoneCallHistoryRecord {
    const id = record.id ?? crypto.randomUUID();
    const updatedAt = record.updatedAt ?? now;
    this.ctx.storage.sql.exec(
      `INSERT INTO phone_call_history (
         id,
         lease_id,
         contact_id,
         display_name,
         e164,
         objective,
         status,
         outcome,
         started_at,
         ended_at,
         duration_seconds,
         summary,
         transcript_status,
         provider_call_sid,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lease_id) DO UPDATE SET
         contact_id = excluded.contact_id,
         display_name = excluded.display_name,
         e164 = excluded.e164,
         objective = excluded.objective,
         status = excluded.status,
         outcome = excluded.outcome,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_seconds = excluded.duration_seconds,
         summary = excluded.summary,
         transcript_status = excluded.transcript_status,
         provider_call_sid = excluded.provider_call_sid,
         updated_at = excluded.updated_at`,
      id,
      record.leaseId,
      record.contactId,
      record.displayName,
      record.e164,
      record.objective,
      record.status,
      record.outcome,
      record.startedAt,
      record.endedAt ?? null,
      record.durationSeconds ?? null,
      record.summary ?? null,
      record.transcriptStatus ?? "none",
      record.providerCallSid ?? null,
      updatedAt,
    );

    const saved = this.ctx.storage.sql
      .exec<StoredPhoneCallHistory>(
        `SELECT
           id,
           lease_id,
           contact_id,
           display_name,
           e164,
           objective,
           status,
           outcome,
           started_at,
           ended_at,
           duration_seconds,
           summary,
           transcript_status,
           provider_call_sid,
           updated_at
         FROM phone_call_history
         WHERE lease_id = ?`,
        record.leaseId,
      )
      .toArray()[0];

    if (!saved) {
      throw new Error("Phone call history record was not saved.");
    }

    return phoneCallHistoryFromRow(saved);
  }

  listCallHistory(limit = 20): PhoneCallHistoryRecord[] {
    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 20;
    const boundedLimit = Math.min(Math.max(requestedLimit, 1), 100);

    return this.ctx.storage.sql
      .exec<StoredPhoneCallHistory>(
        `SELECT
           id,
           lease_id,
           contact_id,
           display_name,
           e164,
           objective,
           status,
           outcome,
           started_at,
           ended_at,
           duration_seconds,
           summary,
           transcript_status,
           provider_call_sid,
           updated_at
         FROM phone_call_history
         ORDER BY started_at DESC
         LIMIT ?`,
        boundedLimit,
      )
      .toArray()
      .map(phoneCallHistoryFromRow);
  }

  getCallHistory(id: string): PhoneCallHistoryRecord | null {
    const row = this.ctx.storage.sql
      .exec<StoredPhoneCallHistory>(
        `SELECT
           id,
           lease_id,
           contact_id,
           display_name,
           e164,
           objective,
           status,
           outcome,
           started_at,
           ended_at,
           duration_seconds,
           summary,
           transcript_status,
           provider_call_sid,
           updated_at
         FROM phone_call_history
         WHERE id = ?`,
        id,
      )
      .toArray()[0];

    return row ? phoneCallHistoryFromRow(row) : null;
  }

  updateCallHistory(
    leaseId: string,
    update: PhoneCallHistoryUpdate,
    now = Date.now(),
  ): boolean {
    const existing = this.ctx.storage.sql
      .exec<StoredPhoneCallHistory>(
        `SELECT
           id,
           lease_id,
           contact_id,
           display_name,
           e164,
           objective,
           status,
           outcome,
           started_at,
           ended_at,
           duration_seconds,
           summary,
           transcript_status,
           provider_call_sid,
           updated_at
         FROM phone_call_history
         WHERE lease_id = ?`,
        leaseId,
      )
      .toArray()[0];

    if (!existing) {
      return false;
    }

    const result = this.ctx.storage.sql.exec(
      `UPDATE phone_call_history
       SET
         status = ?,
         outcome = ?,
         ended_at = ?,
         duration_seconds = ?,
         summary = ?,
         transcript_status = ?,
         provider_call_sid = ?,
         updated_at = ?
       WHERE lease_id = ?`,
      update.status ?? existing.status,
      update.outcome ?? existing.outcome,
      update.endedAt !== undefined ? update.endedAt : existing.ended_at,
      update.durationSeconds !== undefined
        ? update.durationSeconds
        : existing.duration_seconds,
      update.summary !== undefined ? update.summary : existing.summary,
      update.transcriptStatus ?? existing.transcript_status,
      update.providerCallSid !== undefined
        ? update.providerCallSid
        : existing.provider_call_sid,
      now,
      leaseId,
    );

    return result.rowsWritten > 0;
  }

  getStatus(scope: VoiceSafetyScope, now = Date.now()): VoiceSafetyUsage {
    this.expireSessions(now);

    return summarizeVoiceSafetyUsage(this.listSessions(), scope, now);
  }

  createGoogleOAuthState(ttlMs = 10 * 60 * 1_000, now = Date.now()): string {
    this.ctx.storage.sql.exec(
      `DELETE FROM google_oauth_states WHERE expires_at <= ?`,
      now,
    );
    const state = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO google_oauth_states (state, created_at, expires_at)
       VALUES (?, ?, ?)`,
      state,
      now,
      now + ttlMs,
    );

    return state;
  }

  consumeGoogleOAuthState(state: string, now = Date.now()): boolean {
    const result = this.ctx.storage.sql.exec(
      `DELETE FROM google_oauth_states
       WHERE state = ?
         AND expires_at > ?`,
      state,
      now,
    );

    return result.rowsWritten > 0;
  }

  saveGoogleOAuthTokens(
    tokens: {
      refreshToken: string;
      accessToken: string | null;
      accessExpiresAt: number | null;
      scope: string | null;
    },
    now = Date.now(),
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO google_oauth_tokens (
         id, refresh_token, access_token, access_expires_at, scope, updated_at
       ) VALUES ('owner', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         refresh_token = excluded.refresh_token,
         access_token = excluded.access_token,
         access_expires_at = excluded.access_expires_at,
         scope = excluded.scope,
         updated_at = excluded.updated_at`,
      tokens.refreshToken,
      tokens.accessToken,
      tokens.accessExpiresAt,
      tokens.scope,
      now,
    );
  }

  getGoogleOAuthTokens(): {
    refreshToken: string;
    accessToken: string | null;
    accessExpiresAt: number | null;
    scope: string | null;
  } | null {
    const row = this.ctx.storage.sql
      .exec<{
        refresh_token: string;
        access_token: string | null;
        access_expires_at: number | null;
        scope: string | null;
      }>(
        `SELECT refresh_token, access_token, access_expires_at, scope
         FROM google_oauth_tokens
         WHERE id = 'owner'`,
      )
      .toArray()[0];

    return row
      ? {
          refreshToken: row.refresh_token,
          accessToken: row.access_token,
          accessExpiresAt: row.access_expires_at,
          scope: row.scope,
        }
      : null;
  }

  clearGoogleOAuthTokens(): boolean {
    const result = this.ctx.storage.sql.exec(
      `DELETE FROM google_oauth_tokens WHERE id = 'owner'`,
    );

    return result.rowsWritten > 0;
  }

  hasGoogleCalendarConnection(): boolean {
    return this.getGoogleOAuthTokens() !== null;
  }
}
