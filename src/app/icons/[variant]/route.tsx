import { ImageResponse } from "next/og";

// App icons, drawn rather than stored: a white "J" on the brand green. The maskable one
// keeps the letter inside the safe zone phones crop to.
const SIZES: Record<string, { size: number; letter: number; radius: number }> = {
  "192": { size: 192, letter: 120, radius: 40 },
  "512": { size: 512, letter: 320, radius: 104 },
  maskable: { size: 512, letter: 220, radius: 0 },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((variant) => ({ variant }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[variant]">) {
  const spec = SIZES[(await params).variant];
  if (!spec) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#047857",
        borderRadius: spec.radius,
        color: "white",
        fontSize: spec.letter,
        fontWeight: 700,
      }}
    >
      J
    </div>,
    { width: spec.size, height: spec.size },
  );
}
