import { ImageResponse } from "next/og";
import { CARD_HEIGHT, CARD_WIDTH, ShareCardArt } from "@/components/share-card-art";
import { cardFromQuery } from "@/lib/share-card";

// The shareable result card's image: /api/share/card?kind=found&value=1200. Public, since link
// previews fetch it without signing in, and it reads nothing about anyone: the query holds the
// whole card (a kind and a number), and anything else gets Jane's plain card.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const card = cardFromQuery(query.get("kind"), query.get("value"));
  return new ImageResponse(<ShareCardArt card={card} />, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    headers: { "cache-control": "public, max-age=86400, immutable" },
  });
}
