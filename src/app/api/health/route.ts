import { buildCommit } from "@/config/build-commit";

export async function GET() {
  return Response.json({ ok: true, commit: buildCommit() });
}
