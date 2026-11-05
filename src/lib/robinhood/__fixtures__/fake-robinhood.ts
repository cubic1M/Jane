import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Robinhood's sign-in and MCP server, for the unit, integration and end-to-end tests:
// nothing here or in the tests ever talks to Robinhood. Like the real one it offers trading tools, so
// a test can prove Jane never calls them, and it answers with a full account number and with whatever
// hostile text a test gives it. The sign-in checks PKCE and the way back like a real server would.
//
// The tool names are Robinhood's. What each answers is an assumption, the same one
// src/lib/robinhood/parse.ts makes, until a real account shows otherwise (docs/setup/robinhood.md).

export const ACCOUNT_NUMBER_MARKER = "RHMARKER5551234";

export type FakeOptions = {
  // Tool name to answer, in place of the sample one.
  answers?: Record<string, unknown>;
  // Every MCP request answers this HTTP status.
  mcpStatus?: number;
  // Answer tool calls as an event stream rather than JSON.
  eventStream?: boolean;
  // The server's metadata offers a revocation address.
  revocation?: boolean;
  // Tokens stop working: MCP answers 401, and refreshing answers invalid_grant.
  revoked?: boolean;
  // Access tokens stop working, but refreshing still works.
  accessExpired?: boolean;
  // How long access tokens are said to last, in seconds.
  expiresIn?: number;
  // Answers the token address with this status and no tokens.
  tokenStatus?: number;
  // Hold every tool call open this long.
  delayMs?: number;
  // MCP answers a redirect to this address.
  redirectTo?: string;
};

export type FakeRequest = { path: string; method: string; rpc?: string; tool?: string };

type Grant = { challenge: string; redirectUri: string; clientId: string };

const SAMPLE_ANSWERS = new Map<string, unknown>(
  Object.entries({
    get_accounts: {
      accounts: [
        {
          account_number: ACCOUNT_NUMBER_MARKER,
          type: "margin",
          brokerage_account_type: "individual",
          nickname: `Individual ${ACCOUNT_NUMBER_MARKER}`,
        },
      ],
    },
    get_portfolio: { total_value: "90000.00", cash: "20000.00", buying_power: "40000.00" },
    get_equity_positions: {
      positions: [
        {
          symbol: "FCNTX",
          name: "Fidelity Contrafund",
          type: "mutual_fund",
          quantity: "1000",
          price: "20.00",
          average_buy_price: "15.00",
          account_number: ACCOUNT_NUMBER_MARKER,
        },
        {
          symbol: "AAPL",
          name: "Apple",
          type: "stock",
          quantity: "200",
          market_value: "50000.00",
          average_buy_price: "100.00",
        },
      ],
    },
    get_equity_quotes: { quotes: [{ symbol: "AAPL", last_trade_price: "250.00" }] },
    get_equity_orders: {
      orders: [
        {
          id: "order-1",
          side: "sell",
          state: "filled",
          symbol: "AAPL",
          filled_quantity: "10",
          average_price: "250.00",
          last_transaction_at: "2026-03-02T15:00:00Z",
          account_number: ACCOUNT_NUMBER_MARKER,
        },
        {
          id: "order-2",
          side: "buy",
          state: "cancelled",
          symbol: "AAPL",
          quantity: "1",
          price: "1",
        },
      ],
    },
  }),
);

// Robinhood's tools that do something, from its "Trading with your agent" article. Offered like the
// real server offers them.
export const ACTING_TOOLS = [
  "review_equity_order",
  "place_equity_order",
  "cancel_equity_order",
  "review_option_order",
  "place_option_order",
  "cancel_option_order",
  "exercise_option",
  "cancel_option_exercise",
  "preview_crypto_order",
  "place_crypto_order",
  "cancel_crypto_order",
  "review_advanced_order",
  "place_advanced_order",
  "cancel_advanced_order",
  "decline_trade_approval",
  "create_watchlist",
  "update_watchlist",
  "follow_watchlist",
  "unfollow_watchlist",
  "add_to_watchlist",
  "remove_from_watchlist",
  "add_option_to_watchlist",
  "remove_option_from_watchlist",
  "create_alert",
  "update_alert",
  "delete_alert",
  "mark_alerts_read",
  "create_scan",
  "run_scan",
  "update_scan_filters",
  "update_scan_config",
];

const bodyOf = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    request.on("error", reject);
  });

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

export class FakeRobinhood {
  readonly requests: FakeRequest[] = [];
  readonly registered: { client_name?: string; token_endpoint_auth_method?: string }[] = [];
  readonly revokedTokens: string[] = [];
  private grants = new Map<string, Grant>();
  private accessTokens = new Set<string>();
  private refreshTokens = new Set<string>();
  private server: Server | null = null;
  origin = "";

  constructor(public options: FakeOptions = {}) {}

  get mcpUrl(): string {
    return `${this.origin}/mcp/trading`;
  }

  toolCalls(): string[] {
    return this.requests.flatMap((r) => (r.tool ? [r.tool] : []));
  }

  async start(port = 0): Promise<this> {
    this.server = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: "fake server broke" });
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(port, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise((resolve) => this.server?.close(resolve));
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    const log: FakeRequest = { path: url.pathname, method: request.method ?? "" };
    this.requests.push(log);
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      sendJson(response, 200, {
        issuer: this.mcpUrl,
        authorization_endpoint: `${this.origin}/oauth`,
        token_endpoint: `${this.origin}/oauth2/token/`,
        registration_endpoint: `${this.origin}/oauth/trading/register`,
        ...(this.options.revocation ? { revocation_endpoint: `${this.origin}/revoke` } : {}),
        scopes_supported: ["internal"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (url.pathname === "/oauth/trading/register") {
      const body = JSON.parse(await bodyOf(request)) as { client_name?: string };
      this.registered.push(body);
      sendJson(response, 201, { client_id: `fake-client-${randomUUID()}`, ...body });
      return;
    }
    if (url.pathname === "/oauth") return this.signInPage(url, response);
    if (url.pathname === "/oauth2/token/") return this.token(request, response);
    if (url.pathname === "/revoke") {
      const token = new URLSearchParams(await bodyOf(request)).get("token");
      if (token) this.revokedTokens.push(token);
      response.writeHead(200).end();
      return;
    }
    if (url.pathname === "/mcp/trading") return this.mcp(request, response, log);
    response.writeHead(404).end();
  }

  // Robinhood's page, reduced to one link: a real person would sign in here.
  private signInPage(url: URL, response: ServerResponse) {
    const q = url.searchParams;
    const redirectUri = q.get("redirect_uri") ?? "";
    const problem =
      q.get("response_type") !== "code" ||
      q.get("code_challenge_method") !== "S256" ||
      !q.get("code_challenge") ||
      q.get("scope") !== "internal" ||
      !q.get("state") ||
      !q.get("client_id");
    if (problem) {
      response.writeHead(400).end("bad authorization request");
      return;
    }
    const code = randomUUID();
    this.grants.set(code, {
      challenge: q.get("code_challenge") ?? "",
      redirectUri,
      clientId: q.get("client_id") ?? "",
    });
    const back = (params: Record<string, string>) => {
      const to = new URL(redirectUri);
      to.search = new URLSearchParams({ ...params, state: q.get("state") ?? "" }).toString();
      return to.toString();
    };
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      `<!doctype html><title>Fake Robinhood</title><h1>Fake Robinhood sign-in</h1>
       <a id="allow" href="${back({ code })}">Allow</a>
       <a id="deny" href="${back({ error: "access_denied" })}">Deny</a>`,
    );
  }

  private issue(response: ServerResponse) {
    const access = `fake-access-${randomUUID()}`;
    const refresh = `fake-refresh-${randomUUID()}`;
    this.accessTokens.add(access);
    this.refreshTokens.add(refresh);
    sendJson(response, 200, {
      access_token: access,
      refresh_token: refresh,
      token_type: "bearer",
      expires_in: this.options.expiresIn ?? 3600,
      scope: "internal",
    });
  }

  private async token(request: IncomingMessage, response: ServerResponse) {
    const form = new URLSearchParams(await bodyOf(request));
    if (this.options.tokenStatus) {
      sendJson(response, this.options.tokenStatus, { error: "server_error" });
      return;
    }
    if (form.get("grant_type") === "authorization_code") {
      const grant = this.grants.get(form.get("code") ?? "");
      const challenge = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !grant ||
        grant.challenge !== challenge ||
        grant.redirectUri !== form.get("redirect_uri") ||
        grant.clientId !== form.get("client_id")
      ) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      this.grants.delete(form.get("code") ?? "");
      return this.issue(response);
    }
    if (form.get("grant_type") === "refresh_token") {
      const token = form.get("refresh_token") ?? "";
      if (this.options.revoked || !this.refreshTokens.has(token)) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      // A rotating server: the old one is spent.
      this.refreshTokens.delete(token);
      this.options.accessExpired = false;
      return this.issue(response);
    }
    sendJson(response, 400, { error: "unsupported_grant_type" });
  }

  // A token issued by this server, for a test that doesn't go through the sign-in.
  issueTokensForTest(): { accessToken: string; refreshToken: string } {
    const accessToken = `fake-access-${randomUUID()}`;
    const refreshToken = `fake-refresh-${randomUUID()}`;
    this.accessTokens.add(accessToken);
    this.refreshTokens.add(refreshToken);
    return { accessToken, refreshToken };
  }

  private async mcp(request: IncomingMessage, response: ServerResponse, log: FakeRequest) {
    const raw = await bodyOf(request);
    const body = JSON.parse(raw || "{}") as {
      id?: number;
      method?: string;
      params?: { name?: string };
    };
    log.rpc = body.method;
    if (body.method === "tools/call") log.tool = body.params?.name;
    if (this.options.redirectTo) {
      response.writeHead(302, { Location: this.options.redirectTo }).end();
      return;
    }
    const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
    if (this.options.revoked || this.options.accessExpired || !this.accessTokens.has(token)) {
      response.writeHead(401).end();
      return;
    }
    if (this.options.mcpStatus) {
      response.writeHead(this.options.mcpStatus).end();
      return;
    }
    if (body.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    const reply = (result: unknown) => {
      const message = { jsonrpc: "2.0", id: body.id, result };
      if (this.options.eventStream && body.method === "tools/call") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "fake-session",
      });
      response.end(JSON.stringify(message));
    };
    if (body.method === "initialize") {
      reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake" },
      });
      return;
    }
    if (body.method === "tools/list") {
      reply({
        tools: [...SAMPLE_ANSWERS.keys(), ...ACTING_TOOLS].map((name) => ({ name })),
      });
      return;
    }
    if (body.method === "tools/call") {
      if (this.options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
      }
      const name = body.params?.name ?? "";
      if (ACTING_TOOLS.includes(name)) {
        // Exactly what the tests look for: it would really have traded.
        reply({ content: [{ type: "text", text: JSON.stringify({ placed: true }) }] });
        return;
      }
      // Maps, so a name from the request can only find a tool: "constructor" isn't one.
      const answers = new Map(Object.entries(this.options.answers ?? {}));
      const answer = answers.get(name) ?? SAMPLE_ANSWERS.get(name);
      if (answer === undefined) {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "unknown tool" },
        });
        return;
      }
      reply({ content: [{ type: "text", text: JSON.stringify(answer) }] });
      return;
    }
    sendJson(response, 200, {
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "method not found" },
    });
  }
}
