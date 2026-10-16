/* Renders every app icon from one SVG description of the tile and the V.
   The V's lines come from the same module the in-app Mark uses, and both
   colours are read from the dark theme in tokens.css, so the icon is a
   piece of the app rather than a separate drawing. Run: npm run icons for
   the PWA set, npm run desktop:icons for the Tauri and MSIX set. */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

export function makeSvg(size, { shape = "rounded", markWidth = MARK_WIDTH, colors, tile = true }) {
  const { g, scale, x, y } = placeMark(size, markWidth);
  const radius = shape === "rounded" ? size * 0.2 : 0;
  /* Below 64px the hairline falls under a pixel and greys out; a same-colour
     stroke adds about 0.4px of weight on each edge so the V stays crisp. */
  const embolden = size < 64 ? ` stroke="${colors.mark}" stroke-width="${0.8 / scale}" stroke-linejoin="miter"` : "";
  const serifs = g.serifs.map(([sx, sy, w, h]) => `<rect x="${sx}" y="${sy}" width="${w}" height="${h}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${tile ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${colors.tile}"/>` : ""}
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

/* PNGs wrapped in an ICO container, one directory entry per size. */
function ico(pngs, sizes) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(sizes[i] % 256, entry);
    header.writeUInt8(sizes[i] % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
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
    "favicon.ico": render(makeSvg(32, { colors })).then((png) => ico([png], [32])),
  };
  for (const [name, buffer] of Object.entries(outputs)) await writeFile(pub(name), await buffer);
  /* Tabs show the SVG at 16-32px, so it carries the sturdier small V. */
  await writeFile(pub("favicon.svg"), `${makeSvg(32, { colors })}\n`);
  console.log(`icons: ${Object.keys(outputs).length + 1} files in public/ (tile ${colors.tile}, mark ${colors.mark})`);
}

/* Tauri's icon command derives every desktop and mobile size from 1024px
   sources. Windows, Linux and the MSIX tiles take the rounded tile as-is.
   macOS draws no mask of its own, so its tile sits on Apple's 824px grid with
   a transparent margin, or it would look oversized beside other Dock icons.
   iOS flattens onto bg_color, which fills the rounded corners back into a
   square for the system to mask. Android's adaptive icon gets the bare V over
   a tile-coloured layer, sized like the maskable PWA icon within the 72dp
   visible area of the 108dp layer. */
const src = (name) => `${root}src-tauri/icon-source/${name}`;
const MAC_TILE = 824;
const ANDROID_VISIBLE = 72 / 108;

async function desktop() {
  const colors = await darkTokens();
  const maskableWidth = MARK_WIDTH * SAFE_ZONE;
  const macTile = await render(makeSvg(MAC_TILE, { colors }));
  const inset = (1024 - MAC_TILE) / 2;
  const sources = {
    "app-icon.png": render(makeSvg(1024, { colors })),
    "app-icon-macos.png": sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#0000" } })
      .composite([{ input: macTile, left: inset, top: inset }])
      .png({ compressionLevel: 9 })
      .toBuffer(),
    "android-foreground.png": render(makeSvg(1024, { markWidth: maskableWidth * ANDROID_VISIBLE, colors, tile: false })),
    "android-background.png": sharp({ create: { width: 1024, height: 1024, channels: 3, background: colors.tile } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  };
  await mkdir(src(""), { recursive: true });
  for (const [name, buffer] of Object.entries(sources)) await writeFile(src(name), await buffer);
  const manifest = {
    default: "app-icon.png",
    bg_color: colors.tile,
    android_bg: "android-background.png",
    android_fg: "android-foreground.png",
    /* Tauri trims the foreground and scales it to this % of the legacy launcher
       icon; 73 brings the V back to MARK_WIDTH there. */
    android_fg_scale: 73,
  };
  await writeFile(src("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const tauri = (...args) =>
    execFileSync(process.execPath, [`${root}node_modules/@tauri-apps/cli/tauri.js`, "icon", ...args], { cwd: root, stdio: "inherit" });
  const icons = `${root}src-tauri/icons/`;
  tauri(src("manifest.json"));
  const macOut = await mkdtemp(join(tmpdir(), "vaelo-icns-"));
  try {
    tauri(src("app-icon-macos.png"), "-o", macOut);
    await cp(join(macOut, "icon.icns"), `${icons}icon.icns`);
  } finally {
    await rm(macOut, { recursive: true, force: true });
  }

  /* Downsampling the 1024px hairline leaves it grey at taskbar sizes, so the
     small sizes are drawn directly with the sturdier small V. */
  const small = { "32x32.png": 32, "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "StoreLogo.png": 50 };
  for (const [name, size] of Object.entries(small)) await writeFile(`${icons}${name}`, await render(makeSvg(size, { colors })));
  /* App Store Connect rejects any alpha channel, even a fully opaque one. */
  for (const name of await readdir(`${icons}ios`)) {
    const file = `${icons}ios/${name}`;
    await writeFile(file, await sharp(file).flatten({ background: colors.tile }).removeAlpha().png({ compressionLevel: 9 }).toBuffer());
  }
  const icoSizes = [16, 24, 32, 48, 64, 256];
  await writeFile(`${icons}icon.ico`, ico(await Promise.all(icoSizes.map((s) => render(makeSvg(s, { colors })))), icoSizes));
  console.log(`desktop icons: src-tauri/icons from src-tauri/icon-source (tile ${colors.tile}, mark ${colors.mark})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await (process.argv.includes("--desktop") ? desktop() : main());
