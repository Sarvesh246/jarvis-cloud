import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const server = await createServer({ cacheDir: "node_modules/.vite-hold", optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] }, resolve: { dedupe: ["react", "react-dom"] }, root: fileURLToPath(new URL("..", import.meta.url)), server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false } });
let browser;
try {
 await server.listen(); browser = await chromium.launch(); const page = await browser.newPage();
 await page.goto("http://127.0.0.1:5199/tests/fixtures/hold-audit.html");
 const button = page.getByRole("button", { name: "Delete" });
 await button.focus(); await page.keyboard.press("Enter"); assert.equal(await page.locator("output").textContent(), "0");
 await page.keyboard.press("Enter"); assert.equal(await page.locator("output").textContent(), "1");
 await page.keyboard.press("Enter"); assert.equal(await page.locator("output").textContent(), "1");
 console.log("Two keyboard activations confirm exactly once.");
} finally { await browser?.close(); await server.close(); }
