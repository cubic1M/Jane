import { SIGNWELL } from "@/config/connectors";

// SignWell's API, the parts Jane uses (developers.signwell.com: Create Document, Get Document,
// Delete Document, Events, Event Data and Event Hash Verification, read 2026-11-17). Every call
// carries the account's key in X-Api-Key. A document is created and sent in one call (POST
// /api/v1/documents, `draft` false) from a file given as base64 (HTML is one of the types it takes);
// test_mode documents aren't billed and aren't legally binding. Deleting a document cancels its
// signing. Only the fields Jane uses are typed here.

export type SignwellDocument = { id: string; status: string };

export type SignwellSend = {
  name: string;
  subject: string;
  html: string;
  signer: { name: string; email: string };
  // Days before the request expires.
  expiresIn: number;
  // Jane's action id, so a document can be traced back.
  actionId: string;
};

export interface SignwellApi {
  send(document: SignwellSend): Promise<SignwellDocument>;
  get(documentId: string): Promise<SignwellDocument>;
  remove(documentId: string): Promise<boolean>;
}

// SignWell said no (its HTTP status) or the key isn't set. Never carries the key or the body.
export class SignwellError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`SignWell request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "SignwellError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

export function signwellHttp({
  env = process.env,
  fetch: send = fetch,
}: HttpOptions = {}): SignwellApi {
  const key = () => {
    const value = env[SIGNWELL.apiKeyEnv];
    if (!value) throw new SignwellError(null, "NOT_CONFIGURED");
    return value;
  };
  // Production is SIGNWELL_ENV=production; anything else sends test-mode documents.
  const testMode = env[SIGNWELL.envEnv] !== "production";
  const read = async (response: Response) => {
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
      status?: unknown;
    } | null;
    if (!response.ok || typeof body?.id !== "string") {
      throw new SignwellError(response.status, "REFUSED");
    }
    return { id: body.id, status: typeof body.status === "string" ? body.status : "" };
  };
  const checkId = (id: string) => {
    if (!UUID.test(id)) throw new SignwellError(null, "BAD_ID");
  };
  return {
    async send(document) {
      const response = await send(`${SIGNWELL.baseUrl}/api/v1/documents`, {
        method: "POST",
        headers: {
          "x-api-key": key(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          test_mode: testMode,
          draft: false,
          name: document.name,
          subject: document.subject,
          files: [
            {
              name: "permission.html",
              file_base64: Buffer.from(document.html, "utf8").toString("base64"),
            },
          ],
          recipients: [{ id: "1", name: document.signer.name, email: document.signer.email }],
          with_signature_page: true,
          expires_in: document.expiresIn,
          metadata: { jane_action: document.actionId },
        }),
      });
      return read(response);
    },
    async get(documentId) {
      checkId(documentId);
      const response = await send(`${SIGNWELL.baseUrl}/api/v1/documents/${documentId}`, {
        headers: { "x-api-key": key(), accept: "application/json" },
      });
      return read(response);
    },
    async remove(documentId) {
      checkId(documentId);
      const response = await send(`${SIGNWELL.baseUrl}/api/v1/documents/${documentId}`, {
        method: "DELETE",
        headers: { "x-api-key": key() },
      });
      return response.ok;
    },
  };
}
