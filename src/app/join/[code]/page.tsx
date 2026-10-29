import type { Metadata } from "next";
import { headers } from "next/headers";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { cardHeadline, cardImagePath } from "@/lib/share-card";
import { inviteLanding, recordInviteOpened } from "@/lib/share-invites";
import { JoinContent, ONE_LINE } from "./join";

// Where a beta user's share link lands (src/lib/share-invites.ts): what Jane is in one line and
// one button into the closed beta, with their invite code filled in. The link preview shows
// their result card, a rounded total or a check count and nothing else. Not indexed.

type Params = Promise<{ code: string }>;

async function origin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const landing = await inviteLanding((await params).code);
  const title = landing?.card ? cardHeadline(landing.card) : "You're invited to Jane";
  const image = landing?.card ? cardImagePath(landing.card) : "/api/share/card";
  return {
    title,
    description: ONE_LINE,
    robots: { index: false },
    metadataBase: new URL(await origin()),
    openGraph: { title, description: ONE_LINE, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description: ONE_LINE, images: [image] },
  };
}

async function Join({ params }: { params: Params }) {
  await connection();
  const landing = await inviteLanding((await params).code);
  if (landing) {
    const userAgent = (await headers()).get("user-agent");
    after(() => recordInviteOpened(landing.inviteId, userAgent));
  }
  return <JoinContent landing={landing} />;
}

export default function JoinPage({ params }: { params: Params }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16 sm:px-6">
      <Suspense>
        <Join params={params} />
      </Suspense>
    </main>
  );
}
