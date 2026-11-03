import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import {
  bodyFields,
  exportedParameters,
  fieldLiterals,
  hostileArguments,
  hostileParams,
  queryFields,
  valueForField,
  type Target,
} from "./hostile";
import { resolveTree } from "./render";
import { segmentNames, urlOf, type Surface } from "./surfaces";

// One call to one way in, as whoever is acting: a route handler with a real Request, a server
// action with arguments built from its signature, a page rendered down to what it would send.

export type Answer = {
  // Who answered and how, in a form the verdicts read.
  name: string;
  status?: number;
  redirect?: string;
  threw?: string;
  value?: unknown;
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const CALL_MS = 20_000;
const BODY_MS = 3_000;

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// redirect() and notFound() throw these. Everything else thrown is a failure of its own.
export function controlFlow(error: unknown): Pick<Answer, "status" | "redirect"> | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return { redirect: digest.split(";")[2] ?? "" };
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
    return { status: Number(digest.split(";")[1]) };
  }
  return null;
}

function caught(name: string, error: unknown): Answer {
  const flow = controlFlow(error);
  if (flow) return { name, ...flow, value: error };
  return { name, threw: String((error as Error)?.message ?? error), value: error };
}

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
    }
  };
  // A stream may never end (Server-Sent Events): what it sent in this long is enough.
  await withTimeout(pump(), BODY_MS, "body").catch(() => reader.cancel().catch(() => undefined));
  return text;
}

export type RouteOptions = { headers?: Record<string, string>; rawBody?: string };

// One thing to call: built once, run with each attacker.
export type Call = { name: string; run: () => Promise<Answer> };

async function routeCalls(
  surface: Surface,
  target: Target,
  options: RouteOptions,
): Promise<Call[]> {
  const source = readFileSync(surface.file, "utf8");
  const mod = (await import(/* @vite-ignore */ resolve(surface.file))) as Record<string, unknown>;
  const literals = fieldLiterals(source);
  const params: Record<string, unknown> = {};
  let path = urlOf(surface.file);
  for (const { name, catchAll } of segmentNames(surface.file)) {
    const value = valueForField(name, target, literals);
    params[name] = catchAll ? [value] : value;
    path = path.replace(catchAll ? `[...${name}]` : `[${name}]`, encodeURIComponent(value));
  }
  const query = new URLSearchParams();
  for (const field of queryFields(source)) query.set(field, valueForField(field, target, literals));
  const body = Object.fromEntries(
    bodyFields(source).map((field) => [field, valueForField(field, target, literals)]),
  );
  return METHODS.flatMap((method) => {
    const handler = mod[method];
    if (typeof handler !== "function") return [];
    const name = `${method} ${path}`;
    const run = async (): Promise<Answer> => {
      const request = new NextRequest(`http://localhost:3000${path}?${query}`, {
        method,
        headers: { "content-type": "application/json", ...options.headers },
        ...(method === "GET" ? {} : { body: options.rawBody ?? JSON.stringify(body) }),
      });
      try {
        const response = (await withTimeout(
          Promise.resolve(
            (handler as (...a: unknown[]) => unknown)(request, { params: Promise.resolve(params) }),
          ),
          CALL_MS,
          name,
        )) as Response;
        const text = await readBody(response);
        return {
          name,
          status: response.status,
          redirect: response.headers.get("location") ?? undefined,
          value: { body: text, headers: Object.fromEntries(response.headers.entries()) },
        };
      } catch (error) {
        return caught(name, error);
      }
    };
    return [{ name, run }];
  });
}

async function actionCalls(surface: Surface, target: Target): Promise<Call[]> {
  const source = readFileSync(surface.file, "utf8");
  const mod = (await import(/* @vite-ignore */ resolve(surface.file))) as Record<string, unknown>;
  const signatures = exportedParameters(source, surface.file);
  const literals = fieldLiterals(source);
  return Object.entries(mod).flatMap(([name, fn]) => {
    if (typeof fn !== "function") return [];
    const label = `${surface.file}#${name}`;
    const run = async (): Promise<Answer> => {
      try {
        const args = hostileArguments(signatures.get(name), target, literals);
        const value = await withTimeout(
          Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)),
          CALL_MS,
          label,
        );
        return { name: label, value };
      } catch (error) {
        return caught(label, error);
      }
    };
    return [{ name: label, run }];
  });
}

async function pageCalls(surface: Surface, target: Target): Promise<Call[]> {
  const mod = (await import(/* @vite-ignore */ resolve(surface.file))) as {
    default?: (props: unknown) => unknown;
  };
  const page = mod.default;
  const name = urlOf(surface.file);
  if (typeof page !== "function") return [];
  const run = async (): Promise<Answer> => {
    try {
      const params = hostileParams(target);
      const tree = await withTimeout(
        Promise.resolve(
          page({ params: Promise.resolve(params), searchParams: Promise.resolve(params) }),
        ).then((node) => resolveTree(node)),
        CALL_MS,
        name,
      );
      return { name, value: tree };
    } catch (error) {
      return caught(name, error);
    }
  };
  return [{ name, run }];
}

export function callsOf(surface: Surface, target: Target, options: RouteOptions = {}) {
  if (surface.kind === "route") return routeCalls(surface, target, options);
  if (surface.kind === "action") return actionCalls(surface, target);
  return pageCalls(surface, target);
}
