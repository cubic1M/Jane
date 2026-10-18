import { handlers } from "@/auth";
import { ipKey, limitOrNull } from "@/lib/rate-limit";

export const { GET } = handlers;

// Sign-in requests (email links, OAuth callbacks) are rate limited per IP.
export async function POST(request: Request) {
  const limited = await limitOrNull("auth", ipKey(request.headers));
  if (limited) return limited;
  return handlers.POST(request as Parameters<typeof handlers.POST>[0]);
}
