/* Renders every app icon from one SVG description of the tile and the V.
   The V's lines come from the same module the in-app Mark uses, and both
   colours are read from the dark theme in tokens.css, so the icon is a
   piece of the app rather than a separate drawing. Run: npm run icons */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { markGeometry } from "../src/components/markGeometry.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const pub = (name) => `${root}public/${name}`;

/* The V's mass sits at the top and leans on its heavy left stroke, so a
   box-centred V looks high and slightly left. Nudge it, in canvas fractions. */
const OPTICAL = { dx: 0.004, dy: 0.022 };
const MARK_WIDTH = 0.55;
const SAFE_ZONE = 0.8;

async function darkTokens() {
  const css = await readFile(`${root}src/design/tokens.css`, "utf8");
  const block = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*--canvas[^}]*)\}/)[1];
  const token = (name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))[1];
  return { tile: token("canvas"), mark: token("gilt") };
}

/* shape: "rounded" for the plain icon, "square" where the platform crops
   (maskable, iOS). markWidth is the V's width as a fraction of the canvas. */
function placeMark(size, markWidth) {
  const g = markGeometry(size * markWidth);
  const scale = (size * markWidth) / g.bounds.width;
  const x = (size - g.bounds.width * scale) / 2 - g.bounds.x * scale + OPTICAL.dx * size;
  const y = (size - g.bounds.height * scale) / 2 - g.bounds.y * scale + OPTICAL.dy * size;
  return { g, scale, x, y };
}

export function makeSvg(size, { shape = "rounded", markWidth = MARK_WIDTH, colors }) {
  const { g, scale, x, y } = placeMark(size, markWidth);
  const radius = shape === "rounded" ? size * 0.2 : 0;
  /* Below 64px the hairline falls under a pixel and greys out; a same-colour
     stroke adds about 0.4px of weight on each edge so the V stays crisp. */
  const embolden = size < 64 ? ` stroke="${colors.mark}" stroke-width="${0.8 / scale}" stroke-linejoin="miter"` : "";
  const serifs = g.serifs.map(([sx, sy, w, h]) => `<rect x="${sx}" y="${sy}" width="${w}" height="${h}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${colors.tile}"/>
  <g fill="${colors.mark}"${embolden} transform="translate(${x} ${y}) scale(${scale})">
    <path d="${g.heavyPath}"/><path d="${g.hairPath}"/>${serifs}
  </g>
</svg>`;
}

/* Android crops maskable icons to as little as a circle of 80% diameter;
   every extreme point of the V (serif tips and foot) must sit inside it. */
function assertInSafeZone(size, markWidth) {
  const { g, scale, x, y } = placeMark(size, markWidth);
  const tips = g.serifs.flatMap(([sx, sy, w]) => [[sx, sy], [sx + w, sy]]);
  const foot = [[31, 53], [33, 53]];
  const limit = (size * SAFE_ZONE) / 2;
  for (const [px, py] of [...tips, ...foot]) {
    const d = Math.hypot(x + px * scale - size / 2, y + py * scale - size / 2);
    if (d > limit) throw new Error(`maskable mark leaves the safe zone (${d.toFixed(1)} > ${limit})`);
  }
}

/* A single 32px PNG wrapped in an ICO container. */
function ico(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(32, 6);
  header.writeUInt8(32, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const render = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
const opaque = (svg) => sharp(Buffer.from(svg)).flatten().removeAlpha().png({ compressionLevel: 9 }).toBuffer();

async function main() {
  const colors = await darkTokens();
  const maskableWidth = MARK_WIDTH * SAFE_ZONE;
  assertInSafeZone(512, maskableWidth);

  const outputs = {
    "icons/icon-192.png": render(makeSvg(192, { colors })),
    "icons/icon-512.png": render(makeSvg(512, { colors })),
    "icons/icon-maskable-512.png": opaque(makeSvg(512, { shape: "square", markWidth: maskableWidth, colors })),
    "apple-touch-icon.png": opaque(makeSvg(180, { shape: "square", colors })),
    "favicon.ico": render(makeSvg(32, { colors })).then(ico),
  };
  for (const [name, buffer] of Object.entries(outputs)) await writeFile(pub(name), await buffer);
  /* Tabs show the SVG at 16-32px, so it carries the sturdier small V. */
  await writeFile(pub("favicon.svg"), `${makeSvg(32, { colors })}\n`);
  console.log(`icons: ${Object.keys(outputs).length + 1} files in public/ (tile ${colors.tile}, mark ${colors.mark})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
