// Remakes the landing page's pre-rendered art from src/config/landing-art.ts: the poster (the
// first paint and the no-JavaScript fallback for the hero's canvas) and the background tile.
// Same renderer as the browser (src/lib/ascii-diamond.ts), so they're the same pixels.
//
//   npm run render:landing-art
//
// Uses sharp (installed with Next) to read and write the images.
import sharp from "sharp";
import { LANDING_ART } from "../src/config/landing-art.ts";
import { flatField, renderDiamonds, type Raster } from "../src/lib/ascii-diamond.ts";

// Rendered at twice the CSS size, for sharp screens.
const SCALE = 2;
const { recipe } = LANDING_ART;

async function poster() {
  const input = sharp(`public${LANDING_ART.source}`);
  const meta = await input.metadata();
  const crop = {
    left: Math.round(LANDING_ART.crop.x * meta.width!),
    top: Math.round(LANDING_ART.crop.y * meta.height!),
    width: Math.round(LANDING_ART.crop.width * meta.width!),
    height: Math.round(LANDING_ART.crop.height * meta.height!),
  };
  const width = LANDING_ART.posterWidth * SCALE;
  const height = Math.round((width * crop.height) / crop.width);
  const { data } = await input
    .extract(crop)
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const art = renderDiamonds(
    { width, height, data: new Uint8ClampedArray(data) },
    recipe.cellSize * SCALE,
    recipe,
  );
  await write(art, `public${LANDING_ART.poster}`);
  console.log(`poster ${width}x${height} → ${LANDING_ART.poster}`);
}

async function tile() {
  const size = LANDING_ART.tileCells * recipe.cellSize * SCALE;
  const art = renderDiamonds(
    flatField(size, size, LANDING_ART.background),
    recipe.cellSize * SCALE,
    recipe,
    { wrap: true },
  );
  await write(art, `public${LANDING_ART.tile}`);
  console.log(`tile ${size}x${size} → ${LANDING_ART.tile}`);
}

function write(art: Raster, path: string) {
  const image = sharp(Buffer.from(art.data.buffer), {
    raw: { width: art.width, height: art.height, channels: 4 },
  });
  return (
    path.endsWith(".png") ? image.png({ compressionLevel: 9 }) : image.webp({ quality: 85 })
  ).toFile(path);
}

await poster();
await tile();
