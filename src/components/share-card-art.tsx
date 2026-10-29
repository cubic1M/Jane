import { cardLines, type ShareCard } from "@/lib/share-card";

// The result card as next/og draws it (1200 by 630, the link-preview size): black and white,
// Jane's [JANE] tag, the card's two lines and what Jane is. Only the card goes in, so only
// its kind and number can come out. Inline styles, as next/og needs.
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export function ShareCardArt({ card }: { card: ShareCard | null }) {
  const lines = card ? cardLines(card) : { small: "Meet Jane", big: "Your money, checked." };
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#0a0a0a",
        color: "#fafafa",
      }}
    >
      <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 4 }}>[JANE]</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", fontSize: 52, color: "#a3a3a3" }}>{lines.small}</div>
        <div style={{ display: "flex", fontSize: 120, fontWeight: 700, letterSpacing: -3 }}>
          {lines.big}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 30, color: "#a3a3a3" }}>
        An AI financial controller · invite-only beta
      </div>
    </div>
  );
}
