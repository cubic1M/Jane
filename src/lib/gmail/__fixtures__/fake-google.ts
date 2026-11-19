import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { GMAIL_CALLBACK_PATH, GMAIL_SCOPE, googleServer } from "@/config/gmail";

// A stand-in for Google, for every test of Gmail mailboxes: its sign-in page and token address,
// Gmail's API for as many mailboxes as a test connects, and the keys and signed tokens of its
// notices. Nothing here or in the tests ever talks to Google. Like the real one it checks what it
// is sent (the client's secret, PKCE, the way back, the bearer token), ends every permission for an
// account when one of its tokens is revoked, and hands back whatever mail a test gives it, hostile
// or not. Its error answers repeat what they were sent, tokens included, so a test can prove none
// of it is kept. Tokens and keys are made as it runs: none is written in this file.
//
// What each address answers follows Google's documents as read on 2026-11-18 (docs/setup/gmail.md).
// A real mailbox is the founder's test.
//
// A test points the app at it with vi.stubEnv: GMAIL_API_URL to `origin`, GMAIL_CLIENT_ID and
// GMAIL_CLIENT_SECRET to `clientId` and `clientSecret`, and for notices GMAIL_PUSH_AUDIENCE and
// GMAIL_PUSH_SERVICE_ACCOUNT to `pushAudience` and `pushServiceAccount`.

type FakeOptions = {
  // The Google account the next sign-in is for: the one the person picks on Google's page. Each
  // fake starts with an address of its own, so two tests never share a mailbox. Google gives an
  // address back as it was written here, capitals and all.
  address: string;
  // What the token answer says was granted, in place of the Gmail permission.
  grantedScope?: string;
  // The exchange answers without a refresh token.
  noRefreshToken?: boolean;
  // A renewal answers with a new refresh token as well. Google usually keeps the one it gave.
  newRefreshTokens?: boolean;
  // How long access tokens are said to last, in seconds.
  expiresIn?: number;
  // The most history records in one page. All of them unless set.
  historyPageSize?: number;
  // When a watch is said to end. Unset: a week after `now` below, or after the clock's own time.
  watchExpiresAt?: Date;
  // The time a test runs at, when it passes one to the app. The search for recent mail counts its
  // newer_than days back from it; unset, no message is too old.
  now?: Date;
  // Every request answers a redirect to this address.
  redirectTo?: string;
  // What the keys' address serves, in place of the key this fake signs with.
  certs?: unknown;
};

type FakeRequest = {
  method: string;
  path: string;
  // The query as it was sent, without the question mark.
  query: string;
  // The bearer token it came with.
  bearer: string | null;
  // What it posted: a form's fields, or JSON.
  form: Record<string, string>;
  json: unknown;
  // What it was answered. 0 while it is held, and for a connection that was cut.
  status: number;
};

type Header = { name: string; value: string };
type Part = {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Header[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: Part[];
};

type FakeMail = {
  // Gmail's id for it. Made up unless given.
  id?: string;
  // Its labels. null: the message comes without labelIds, as one with no label does. Left out:
  // the inbox's, unread, in the Updates tab.
  labelIds?: string[] | null;
  // Every From header as written: one, unless a test wants two.
  from?: string | string[];
  to?: string;
  subject?: string;
  snippet?: string;
  // Every Authentication-Results header, the top one first. Left out: one from Google saying the
  // From address's own domain passed DMARC, so the email counts as checked.
  authResults?: string[];
  // Any other headers, such as X-Gmail-Fetch-Info.
  headers?: Header[];
  // When Google took it in. null: the message comes without internalDate. Left out: a fixed
  // moment, so no test depends on the day it runs.
  receivedAt?: Date | null;
  // Gmail's own estimate of its size. null: left out. Left out: what the payload weighs.
  sizeEstimate?: number | null;
  // The bodies. Both: two parts side by side (multipart/alternative). Neither: a short plain one.
  text?: string;
  html?: string;
  // A file's name: the bodies then sit one level down, beside the file (multipart/mixed).
  attachment?: string;
  // The whole payload as Gmail would send it, for a shape the fields above can't make. The
  // headers above are then left out: the payload brings its own.
  payload?: unknown;
};

type FakeMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload: unknown;
};

type Answer = { status: number; json?: unknown; location?: string };
type Where = string | RegExp;

const DAY_MS = 24 * 60 * 60 * 1000;
// When a message arrived, unless a test says.
const RECEIVED = Date.UTC(2026, 10, 3, 17, 0, 0);
// Larger than a JavaScript number holds exactly, as Gmail's ids may be: code that reads one as a
// number, and not as text or a BigInt, loses its place here too.
const FIRST_HISTORY_ID = BigInt("9007199254741000");

const fieldsOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const matches = (where: Where, path: string): boolean =>
  typeof where === "string" ? path.endsWith(where) : where.test(path);

const sha256 = (text: string): string => createHash("sha256").update(text).digest("base64url");

// Gmail's API writes an error like this. The message repeats the token it was sent.
function gmailProblem(status: number, reason: string, asked?: FakeRequest): Answer {
  const message = `${reason}: the request was ${asked?.bearer ?? "not understood"}`;
  const domain = reason.endsWith("LimitExceeded") ? "usageLimits" : "global";
  return {
    status,
    json: { error: { code: status, message, errors: [{ domain, reason, message }] } },
  };
}

const REASONS = new Map<number, string>([
  [400, "badRequest"],
  [401, "authError"],
  [403, "forbidden"],
  [404, "notFound"],
  [429, "rateLimitExceeded"],
]);

// Gmail's JSON for an error with a reason of the test's choosing, such as userRateLimitExceeded.
export const gmailError = (status: number, reason: string): unknown =>
  gmailProblem(status, reason).json;

const leaf = (mimeType: string, text: string): Part => ({
  partId: "",
  mimeType,
  filename: "",
  headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }],
  body: { size: Buffer.byteLength(text), data: Buffer.from(text, "utf8").toString("base64url") },
});

const group = (mimeType: string, parts: Part[]): Part => ({
  partId: "",
  mimeType,
  filename: "",
  headers: [{ name: "Content-Type", value: `${mimeType}; boundary="fake-boundary"` }],
  body: { size: 0 },
  parts,
});

// Gmail numbers parts by where they sit: "0" and "1", then "0.0" inside the first.
const numbered = (part: Part, partId = ""): Part => ({
  ...part,
  partId,
  ...(part.parts
    ? {
        parts: part.parts.map((child, index) =>
          numbered(child, partId ? `${partId}.${index}` : String(index)),
        ),
      }
    : {}),
});

// The body Gmail would hand over: the plain and HTML texts, side by side when there are both, and
// one level down when a file comes with them.
function bodyParts(text: string | null, { html, attachment }: FakeMail): Part {
  const bodies = [
    ...(text === null ? [] : [leaf("text/plain", text)]),
    ...(html === undefined ? [] : [leaf("text/html", html)]),
  ];
  const body = bodies.length === 1 ? bodies[0] : group("multipart/alternative", bodies);
  if (attachment === undefined) return numbered(body);
  const file: Part = {
    partId: "",
    mimeType: "application/pdf",
    filename: attachment,
    headers: [{ name: "Content-Disposition", value: `attachment; filename="${attachment}"` }],
    body: { size: 20_000, attachmentId: `fake-attachment-${randomUUID()}` },
  };
  return numbered(group("multipart/mixed", [body, file]));
}

// A Gmail message as its API sends one in full: headers, labels, snippet, and the bodies as
// base64url parts, nested when there are several.
export function fakeMessage(mail: FakeMail = {}): FakeMessage {
  const id = mail.id ?? randomBytes(8).toString("hex");
  const from = [mail.from ?? "Northwind Power <billing@northwind-power.example>"].flat();
  const domain = (/@([^\s>"]+)/.exec(from[0] ?? "")?.[1] ?? "unknown.example").toLowerCase();
  // What Google writes when the sender's own domain passed all three of its checks.
  const passed = [
    `dkim=pass header.i=@${domain} header.s=s1`,
    `spf=pass (google.com: domain of bounce@${domain} designates 192.0.2.10 as permitted sender) smtp.mailfrom=bounce@${domain}`,
    `dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`,
  ].join("; ");
  const labelIds =
    mail.labelIds === undefined ? ["INBOX", "UNREAD", "CATEGORY_UPDATES"] : mail.labelIds;
  const received = mail.receivedAt === undefined ? new Date(RECEIVED) : mail.receivedAt;
  const text =
    mail.text ?? (mail.html === undefined ? "Thanks for your payment.\nTotal: $42.10\n" : null);
  const body = bodyParts(text, mail);
  const to = mail.to ?? "someone@fake-mailbox.test";
  const headers: Header[] = [
    { name: "Delivered-To", value: to },
    { name: "Received", value: "by mx.google.com with ESMTPS id fake" },
    // Not the header the sender check reads, though its name ends the same way.
    { name: "ARC-Authentication-Results", value: `i=1; mx.google.com; ${passed}` },
    ...(mail.authResults ?? [`mx.google.com; ${passed}`]).map((value) => ({
      name: "Authentication-Results",
      value,
    })),
    ...(mail.headers ?? []),
    ...from.map((value) => ({ name: "From", value })),
    { name: "To", value: to },
    { name: "Subject", value: mail.subject ?? "Your receipt from Northwind Power" },
    { name: "Date", value: (received ?? new Date(RECEIVED)).toUTCString() },
  ];
  const payload = mail.payload ?? { ...body, headers: [...headers, ...body.headers] };
  const size =
    mail.sizeEstimate === undefined
      ? Buffer.byteLength(JSON.stringify(payload))
      : mail.sizeEstimate;
  return {
    id,
    threadId: id,
    ...(labelIds ? { labelIds } : {}),
    snippet: mail.snippet ?? (text ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    ...(received ? { internalDate: String(received.getTime()) } : {}),
    ...(size === null ? {} : { sizeEstimate: size }),
    payload,
  };
}

// What Gmail's "metadata" format leaves of a message: no bodies, and only the headers asked for.
function metadataOf(message: FakeMessage, wanted: string[]): unknown {
  const { payload, ...rest } = message;
  const { mimeType, headers } = fieldsOf(payload);
  const names = new Set(wanted.map((name) => name.toLowerCase()));
  const kept = (Array.isArray(headers) ? headers : []).filter(
    (header: unknown) => names.size === 0 || names.has(String(fieldsOf(header).name).toLowerCase()),
  );
  return { ...rest, payload: { mimeType, headers: kept } };
}

// What the search for recent mail leaves out by label, for each term the app's query may carry.
const SEARCH_EXCLUDES = new Map([
  ["-category:promotions", "CATEGORY_PROMOTIONS"],
  ["-category:social", "CATEGORY_SOCIAL"],
  ["-category:forums", "CATEGORY_FORUMS"],
  ["-in:sent", "SENT"],
  ["-in:drafts", "DRAFT"],
]);

// One Google account's mail. A test fills it with deliver() and its relatives, before or while the
// app reads.
class FakeMailbox {
  // Every message in the mailbox, by Gmail's id, in the order it arrived.
  readonly messages = new Map<string, FakeMessage>();
  // What the last watch asked for, until it is stopped.
  watch: Record<string, unknown> | null = null;
  private records: { id: bigint; added: { id: string; labelIds?: string[] }[] }[] = [];
  private current = FIRST_HISTORY_ID;
  // A place before this one gets a 404, as when Gmail has let its history go.
  private floor = FIRST_HISTORY_ID;

  constructor(readonly address: string) {}

  // The mailbox's newest place: what getProfile says, and the id of the last record made.
  get historyId(): string {
    return String(this.current);
  }

  // One email arrives: it is kept, and one history record says so.
  deliver(mail: FakeMail = {}, record: { labels?: boolean } = {}): FakeMessage {
    return this.deliverTogether([mail], record)[0];
  }

  // Several emails arrive in one history record.
  deliverTogether(mails: FakeMail[], record: { labels?: boolean } = {}): FakeMessage[] {
    const messages = mails.map((mail) => fakeMessage({ to: this.address, ...mail }));
    for (const message of messages) this.messages.set(message.id, message);
    this.addRecord(
      messages.map((message) => message.id),
      record,
    );
    return messages;
  }

  // A history record saying these messages arrived, whether or not the mailbox has them: the same
  // message again, or one that is gone by the time it is asked for. `labels: false` leaves the
  // labels off the record, as Gmail sometimes does.
  addRecord(ids: string[], { labels = true }: { labels?: boolean } = {}): void {
    this.current += BigInt(1);
    this.records.push({
      id: this.current,
      added: ids.map((id) => {
        const labelIds = labels ? this.messages.get(id)?.labelIds : undefined;
        return labelIds ? { id, labelIds } : { id };
      }),
    });
  }

  // Something else changed (a label, a read mark): the place moves on with no new mail.
  bump(): void {
    this.current += BigInt(1);
  }

  // The message is deleted. Records that named it stay.
  remove(id: string): void {
    this.messages.delete(id);
  }

  // Gmail lets its history go: every place before the newest one now gets a 404.
  loseHistory(): void {
    this.floor = this.current;
  }

  // What history.list answers: records strictly after the place asked for, oldest first.
  historyAnswer(query: URLSearchParams, pageSize: number | undefined): Answer {
    const start = query.get("startHistoryId") ?? "";
    const token = query.get("pageToken");
    const after = token === null ? start : (/^after-(\d+)$/.exec(token)?.[1] ?? "");
    if (!/^\d+$/.test(start) || !/^\d+$/.test(after)) return gmailProblem(400, "invalidArgument");
    if (BigInt(start) < this.floor) return gmailProblem(404, "notFound");
    const rest = this.records.filter((record) => record.id > BigInt(after));
    const page = rest.slice(0, pageSize ?? rest.length);
    const last = page.at(-1);
    return {
      status: 200,
      json: {
        ...(page.length > 0
          ? {
              history: page.map((record) => ({
                id: String(record.id),
                messages: record.added.map(({ id }) => ({ id, threadId: id })),
                messagesAdded: record.added.map((message) => ({
                  message: { ...message, threadId: message.id },
                })),
              })),
            }
          : {}),
        ...(last && rest.length > page.length ? { nextPageToken: `after-${last.id}` } : {}),
        historyId: this.historyId,
      },
    };
  }

  // What messages.list answers: the newest first, without spam, the trash, and what the query's
  // own terms leave out.
  searchAnswer(query: URLSearchParams, now: Date | undefined): Answer {
    const terms = (query.get("q") ?? "").split(/\s+/);
    const excluded = new Set(["SPAM", "TRASH"]);
    for (const term of terms) {
      const label = SEARCH_EXCLUDES.get(term);
      if (label) excluded.add(label);
    }
    const days = Number(
      /^newer_than:(\d+)d$/.exec(terms.find((t) => /^newer_than:/.test(t)) ?? "")?.[1],
    );
    const oldest = now && Number.isFinite(days) ? now.getTime() - days * DAY_MS : null;
    const found = [...this.messages.values()]
      .reverse()
      .filter((message) => !(message.labelIds ?? []).some((label) => excluded.has(label)))
      .filter(
        (message) =>
          oldest === null ||
          message.internalDate === undefined ||
          Number(message.internalDate) >= oldest,
      )
      .slice(0, Number(query.get("maxResults") ?? 100));
    return {
      status: 200,
      json: {
        ...(found.length > 0
          ? { messages: found.map(({ id, threadId }) => ({ id, threadId })) }
          : {}),
        resultSizeEstimate: found.length,
      },
    };
  }

  // What messages.get answers, in either format.
  messageAnswer(id: string, query: URLSearchParams): Answer {
    const message = this.messages.get(id);
    if (!message) return gmailProblem(404, "notFound");
    const format = query.get("format") ?? "full";
    if (format === "full") return { status: 200, json: message };
    if (format !== "metadata") return gmailProblem(400, "invalidArgument");
    return { status: 200, json: metadataOf(message, query.getAll("metadataHeaders")) };
  }
}

type Grant = { address: string; refreshToken: string; accessToken: string | null; ended: boolean };
type Code = { challenge: string; redirectUri: string; address: string; offline: boolean };
type KeyPair = { publicKey: KeyObject; privateKey: KeyObject };

// One key pair for every fake in a test file, since making one takes a moment. A test that needs
// another asks with rotateKeys().
let sharedPair: KeyPair | null = null;
const newPair = (): KeyPair => generateKeyPairSync("rsa", { modulusLength: 2048 });

const bodyOf = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    request.on("error", reject);
  });

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const tokenPart = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export class FakeGoogle {
  // Every request it was sent, in order.
  readonly requests: FakeRequest[] = [];
  // Every token it was asked to revoke, whether or not it took it.
  readonly revokedTokens: string[] = [];
  // The mailboxes whose notices it was asked to stop.
  readonly stopped: string[] = [];
  // What the app must send to the token address: a test puts these in the environment.
  readonly clientId = `fake-client-${randomUUID()}.apps.googleusercontent.com`;
  readonly clientSecret = `fake-secret-${randomUUID()}`;
  // What a notice's token is made for: a test puts these in the environment too.
  readonly pushAudience = "https://jane.example/api/gmail/webhook";
  readonly pushServiceAccount = "gmail-notices@fake-project.iam.gserviceaccount.com";
  // Change these while it runs, between one request and the next.
  options: FakeOptions;
  origin = "";
  private server: Server | null = null;
  private paths = { authorize: "", token: "", revoke: "", api: "", certs: "" };
  private mailboxes = new Map<string, FakeMailbox>();
  private codes = new Map<string, Code>();
  private grants: Grant[] = [];
  private planned: { where: Where; times: number; status: number; body?: unknown }[] = [];
  private holds: { where: Where; reach: () => void; released: Promise<void> }[] = [];
  private letAllGo: (() => void)[] = [];
  private signing: (KeyPair & { kid: string }) | null = null;

  constructor(options: Partial<FakeOptions> = {}) {
    this.options = { address: `person.${randomUUID()}@fake-mailbox.test`, ...options };
  }

  async start(): Promise<this> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500).end("fake server broke");
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // The same paths the app is given for a server on this machine (src/config/gmail.ts).
    const at = googleServer({ GMAIL_API_URL: this.origin });
    const pathOf = (address: string) => new URL(address).pathname;
    this.paths = {
      authorize: pathOf(at.authorize),
      token: pathOf(at.token),
      revoke: pathOf(at.revoke),
      api: pathOf(at.api),
      certs: pathOf(at.certs),
    };
    return this;
  }

  async stop(): Promise<void> {
    const { server } = this;
    if (!server) return;
    for (const release of this.letAllGo) release();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  // The mail of one Google account, made the first time it is asked for. Capitals don't matter.
  mailbox(address: string = this.options.address): FakeMailbox {
    const key = address.toLowerCase();
    const box = this.mailboxes.get(key) ?? new FakeMailbox(address);
    this.mailboxes.set(key, box);
    return box;
  }

  // Tokens this server will take, for a test that doesn't go through the sign-in.
  issueTokensForTest(address: string = this.options.address): {
    accessToken: string;
    refreshToken: string;
  } {
    const grant = this.grant(address);
    return { accessToken: grant.accessToken ?? "", refreshToken: grant.refreshToken };
  }

  // What a person does on Google's page: opens it, picks the account in options.address, and
  // allows or denies. Gives the address their browser is then sent back to, with the code or the
  // refusal on it. Throws when the page itself refuses the request, as Google's would show an error.
  async signIn(authorizeUrl: string, choice: "allow" | "deny" = "allow"): Promise<string> {
    if (!authorizeUrl.startsWith(`${this.origin}/`)) {
      throw new Error("Not this fake's sign-in page");
    }
    const page = await fetch(authorizeUrl);
    const back = fieldsOf(await page.json())[choice];
    if (!page.ok || typeof back !== "string") {
      throw new Error("The fake sign-in page refused the request");
    }
    return back;
  }

  // The next `times` requests to a matching path get this status in place of the real answer: a
  // text is the end of the path, a pattern is tried on all of it. Without a body, an error as
  // Google would write one, repeating what it was sent.
  answerWith(
    where: Where,
    status: number,
    { times = 1, body }: { times?: number; body?: unknown } = {},
  ): void {
    this.planned.push({ where, times, status, body });
  }

  // The next `times` requests to a matching path get no answer: the connection is cut.
  hangUp(where: Where, times = 1): void {
    this.planned.push({ where, times, status: 0 });
  }

  // Holds the next request to a matching path, before anything is answered, until release() is
  // called. `reached` settles once that request has arrived, so a test can change something
  // while the app waits, with no sleep.
  hold(where: Where): { reached: Promise<void>; release: () => void } {
    let reach = () => {};
    let release = () => {};
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.push({ where, reach, released });
    this.letAllGo.push(release);
    return { reached, release };
  }

  // Access tokens run out early: Gmail's API answers 401 until a renewal brings a new one.
  expireAccessTokens(): void {
    for (const grant of this.grants) grant.accessToken = null;
  }

  // The person takes Jane's permission back in their Google account, or changes their password:
  // every token for that account stops working, and renewing answers invalid_grant.
  takeBack(address: string = this.options.address): void {
    for (const grant of this.grants) {
      if (grant.address.toLowerCase() === address.toLowerCase()) grant.ended = true;
    }
  }

  // Google changes its keys: a new pair signs from now on, and the old one is no longer published.
  rotateKeys(): void {
    this.signing = { kid: randomUUID(), ...newPair() };
  }

  // The key this fake signs notices with, and publishes at the keys' address.
  get key(): KeyPair & { kid: string } {
    sharedPair ??= newPair();
    this.signing ??= { kid: randomUUID(), ...sharedPair };
    return this.signing;
  }

  // The token Google's push subscription sends with a notice, signed with this fake's key. Any
  // header or claim can be replaced (undefined takes a claim out), and another key can sign it,
  // so a test can forge one whichever way it likes.
  noticeToken({
    header = {},
    claims = {},
    key = this.key.privateKey,
    now = new Date(),
  }: {
    header?: Record<string, unknown>;
    claims?: Record<string, unknown>;
    key?: KeyObject;
    now?: Date;
  } = {}): string {
    const seconds = Math.floor(now.getTime() / 1000);
    const head = tokenPart({ alg: "RS256", kid: this.key.kid, typ: "JWT", ...header });
    const body = tokenPart({
      iss: "https://accounts.google.com",
      aud: this.pushAudience,
      azp: this.pushServiceAccount,
      email: this.pushServiceAccount,
      email_verified: true,
      sub: "fake-service-account",
      iat: seconds,
      exp: seconds + 3600,
      ...claims,
    });
    const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key);
    return `${head}.${body}.${signature.toString("base64url")}`;
  }

  // The ids of the messages fetched in this format, in order: a test proves with it that an email
  // it expected to be skipped was never fetched in full.
  fetched(format: "metadata" | "full"): string[] {
    const prefix = `${this.paths.api}/messages/`;
    return this.requests
      .filter(({ path, query }) => path.startsWith(prefix) && query.includes(`format=${format}`))
      .map(({ path }) => decodeURIComponent(path.slice(prefix.length)));
  }

  private grant(address: string): Grant {
    const grant: Grant = {
      address,
      refreshToken: `fake-refresh-${randomUUID()}`,
      accessToken: `fake-access-${randomUUID()}`,
      ended: false,
    };
    this.grants.push(grant);
    return grant;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    const sent = await bodyOf(request);
    const type = request.headers["content-type"] ?? "";
    const asked: FakeRequest = {
      method: request.method ?? "",
      path: url.pathname,
      query: url.search.slice(1),
      bearer: /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? null,
      form: type.includes("x-www-form-urlencoded")
        ? Object.fromEntries(new URLSearchParams(sent))
        : {},
      json: type.includes("json") ? parsed(sent) : null,
      status: 0,
    };
    this.requests.push(asked);
    const held = this.holds.findIndex(({ where }) => matches(where, asked.path));
    if (held >= 0) {
      const [hold] = this.holds.splice(held, 1);
      hold.reach();
      await hold.released;
    }
    const answer = this.answerTo(asked, url.searchParams);
    if (answer === null) {
      request.socket.destroy();
      return;
    }
    asked.status = answer.status;
    if (answer.location) {
      response.writeHead(answer.status, { Location: answer.location }).end();
    } else if (answer.json !== undefined) {
      response.writeHead(answer.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(answer.json));
    } else {
      response.writeHead(answer.status).end();
    }
  }

  // null: no answer at all.
  private answerTo(asked: FakeRequest, query: URLSearchParams): Answer | null {
    if (this.options.redirectTo) return { status: 302, location: this.options.redirectTo };
    const { path } = asked;
    const signInAddress = path === this.paths.token || path === this.paths.revoke;
    const plan = this.planned.find(({ where, times }) => times > 0 && matches(where, path));
    if (plan) {
      plan.times -= 1;
      if (plan.status === 0) return null;
      if (plan.body !== undefined) return { status: plan.status, json: plan.body };
      return signInAddress
        ? { status: plan.status, json: this.signInProblem("server_error", asked) }
        : gmailProblem(plan.status, REASONS.get(plan.status) ?? "backendError", asked);
    }
    if (path === this.paths.authorize) return this.signInPage(query);
    if (path === this.paths.token) return this.token(asked);
    if (path === this.paths.revoke) return this.revoke(asked);
    if (path === this.paths.certs) {
      return { status: 200, json: this.options.certs ?? this.keySet() };
    }
    if (path.startsWith(`${this.paths.api}/`)) {
      return this.gmail(asked, path.slice(this.paths.api.length), query);
    }
    return { status: 404, json: { error: "not found" } };
  }

  // The token address writes an error like this. The description repeats what it was sent.
  private signInProblem(error: string, asked: FakeRequest): unknown {
    return { error, error_description: `Refused: ${JSON.stringify(asked.form)}` };
  }

  private keySet(): unknown {
    const { kid, publicKey } = this.key;
    return { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] };
  }

  // Google's page, reduced to the two addresses it can send the browser back to: a real person
  // would sign in and pick an account here. It refuses a request Jane's sign-in should never make,
  // and a way back other than the one path registered with Google.
  private signInPage(query: URLSearchParams): Answer {
    const redirectUri = query.get("redirect_uri") ?? "";
    const registered =
      URL.canParse(redirectUri) &&
      redirectUri === `${new URL(redirectUri).origin}${GMAIL_CALLBACK_PATH}`;
    const problem =
      query.get("response_type") !== "code" ||
      query.get("client_id") !== this.clientId ||
      !registered ||
      query.get("scope") !== GMAIL_SCOPE ||
      query.get("code_challenge_method") !== "S256" ||
      !query.get("code_challenge") ||
      !query.get("state") ||
      query.has("include_granted_scopes");
    if (problem) return { status: 400, json: { error: "bad authorization request" } };
    const code = randomUUID();
    this.codes.set(code, {
      challenge: query.get("code_challenge") ?? "",
      redirectUri,
      address: this.options.address,
      // Google gives a refresh token only for offline access, and again only when consent is asked.
      offline:
        query.get("access_type") === "offline" &&
        (query.get("prompt") ?? "").split(" ").includes("consent"),
    });
    const back = (params: Record<string, string>) => {
      const to = new URL(redirectUri);
      to.search = new URLSearchParams({ ...params, state: query.get("state") ?? "" }).toString();
      return to.toString();
    };
    return {
      status: 200,
      json: {
        allow: back({ code, scope: GMAIL_SCOPE }),
        deny: back({ error: "access_denied" }),
      },
    };
  }

  private issued(grant: Grant, refreshToken: string | null): Answer {
    return {
      status: 200,
      json: {
        access_token: grant.accessToken,
        expires_in: this.options.expiresIn ?? 3599,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        scope: this.options.grantedScope ?? GMAIL_SCOPE,
        token_type: "Bearer",
      },
    };
  }

  private token(asked: FakeRequest): Answer {
    const { form } = asked;
    if (form.client_id !== this.clientId || form.client_secret !== this.clientSecret) {
      return { status: 401, json: this.signInProblem("invalid_client", asked) };
    }
    if (form.grant_type === "authorization_code") {
      const code = this.codes.get(form.code ?? "");
      if (
        !code ||
        code.challenge !== sha256(form.code_verifier ?? "") ||
        code.redirectUri !== form.redirect_uri
      ) {
        return { status: 400, json: this.signInProblem("invalid_grant", asked) };
      }
      // A code works once.
      this.codes.delete(form.code ?? "");
      const grant = this.grant(code.address);
      const refresh = code.offline && !this.options.noRefreshToken ? grant.refreshToken : null;
      return this.issued(grant, refresh);
    }
    if (form.grant_type === "refresh_token") {
      const grant = this.grants.find((g) => !g.ended && g.refreshToken === form.refresh_token);
      if (!grant) return { status: 400, json: this.signInProblem("invalid_grant", asked) };
      // Only the newest access token works, so a test can prove the new one was saved and used.
      grant.accessToken = `fake-access-${randomUUID()}`;
      if (!this.options.newRefreshTokens) return this.issued(grant, null);
      grant.refreshToken = `fake-refresh-${randomUUID()}`;
      return this.issued(grant, grant.refreshToken);
    }
    return { status: 400, json: this.signInProblem("unsupported_grant_type", asked) };
  }

  // The token must be in the form's body: one put in the address isn't seen.
  private revoke(asked: FakeRequest): Answer {
    const token = asked.form.token ?? "";
    if (token) this.revokedTokens.push(token);
    const grant = this.grants.find(
      (g) => !g.ended && token !== "" && (g.refreshToken === token || g.accessToken === token),
    );
    if (!grant) return { status: 400, json: this.signInProblem("invalid_token", asked) };
    // Google's rule: one revoke ends every permission the project holds for that account.
    this.takeBack(grant.address);
    return { status: 200, json: {} };
  }

  private gmail(asked: FakeRequest, path: string, query: URLSearchParams): Answer {
    const grant = this.grants.find(
      (g) => !g.ended && g.accessToken !== null && g.accessToken === asked.bearer,
    );
    if (!grant) return gmailProblem(401, "authError", asked);
    const box = this.mailbox(grant.address);
    const posted = asked.method === "POST";
    if (path === "/profile" && !posted) {
      const total = box.messages.size;
      return {
        status: 200,
        json: {
          emailAddress: box.address,
          messagesTotal: total,
          threadsTotal: total,
          historyId: box.historyId,
        },
      };
    }
    if (path === "/watch" && posted) {
      const body = fieldsOf(asked.json);
      const topic = typeof body.topicName === "string" ? body.topicName : "";
      if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topic)) {
        return gmailProblem(400, "invalidArgument", asked);
      }
      box.watch = body;
      const ends =
        this.options.watchExpiresAt ??
        new Date((this.options.now ?? new Date()).getTime() + 7 * DAY_MS);
      // Both arrive as text, as Gmail sends them.
      return {
        status: 200,
        json: { historyId: box.historyId, expiration: String(ends.getTime()) },
      };
    }
    if (path === "/stop" && posted) {
      box.watch = null;
      this.stopped.push(box.address);
      return { status: 204 };
    }
    if (path === "/history" && !posted) {
      return box.historyAnswer(query, this.options.historyPageSize);
    }
    if (path === "/messages" && !posted) return box.searchAnswer(query, this.options.now);
    const id = /^\/messages\/([^/]+)$/.exec(path)?.[1];
    if (id && !posted) return box.messageAnswer(decodeURIComponent(id), query);
    return gmailProblem(404, "notFound", asked);
  }
}
