import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Hash the actual build graph. Activation removes old deployment assets;
// first-paint dependencies are available offline before the worker takes over.
function offlineShell() {
  let config;
  return {
    name: "vaelo-offline-shell",
    configResolved(value) { config = value; },
    transformIndexHtml: { order: "post", handler(html, context) {
      if (!context.bundle) return html;
      const font = Object.keys(context.bundle).find(name => /newsreader-latin-opsz-normal-[^/]+\.woff2$/.test(name));
      return font ? html.replace("</head>", `<link rel="preload" href="/${font}" as="font" type="font/woff2" crossorigin></head>`) : html;
    } },
    async writeBundle(_, bundle) {
      const assets = Object.keys(bundle).map(name => "/" + name);
      const entry = Object.values(bundle).find(item => item.type === "chunk" && item.isEntry);
      const critical = new Set(["/", "/prefs.js"]);
      function visit(chunk) {
        if (!chunk || critical.has("/" + chunk.fileName)) return;
        critical.add("/" + chunk.fileName);
        for (const name of chunk.imports) visit(bundle[name]);
      }
      visit(entry);
      for (const name of assets) if (/\.(css|woff2)$/.test(name) && !/katex|jetbrains/i.test(name)) critical.add(name);
      const version = createHash("sha256").update(assets.sort().join("\n")).digest("hex").slice(0, 16);
      const source = (await readFile(resolve(config.root, "public/sw.js"), "utf8"))
        .replace('"vaelo-shell-v7"', JSON.stringify("vaelo-shell-" + version))
        .replace('["/", "/prefs.js"]', JSON.stringify([...critical]))
        .replace('const CURRENT_ASSETS = null;', "const CURRENT_ASSETS = " + JSON.stringify(assets) + ";");
      await writeFile(resolve(config.root, config.build.outDir, "sw.js"), source);
    },
  };
}
const testRun = process.execArgv.some(value => value.startsWith("--test")) || Boolean(process.env.NODE_TEST_CONTEXT);
export default defineConfig({ server: { watch: { ignored: ["**/src-tauri/**"] }, hmr: testRun ? false : undefined }, plugins: [react(), {
  name: "vaelo-server-renderer", enforce: "pre",
  resolveId(id, importer, options) {
    if (options?.ssr && /(?:^|\/)Blocks\.jsx$/.test(id)) return resolve("src/components/blocks/ReplyRenderer.jsx");
  },
}, offlineShell()], optimizeDeps: { noDiscovery: testRun, entries: testRun ? [] : ["index.html"] }, build: { manifest: true } });
