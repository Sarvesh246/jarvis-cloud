import { json, fail, HttpError } from "../server/security.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const response = await fetch("https://api.github.com/repos/Sarvesh246/jarvis-cloud/releases?per_page=20", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Vaelo-downloads" }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new HttpError(503, "Downloads are available on GitHub.");
    const releases = await response.json();
    const release = releases.find(item => /^desktop-v\d+\.\d+\.\d+$/.test(item.tag_name) && !item.draft && !item.prerelease);
    if (!release) throw new HttpError(404, "The first desktop release is being prepared.");
    json(res, 200, { version: release.tag_name.slice(9), assets: release.assets.filter(asset =>
      /\.(exe|msi|dmg|deb|rpm|AppImage)$/.test(asset.name) &&
      asset.browser_download_url.startsWith("https://github.com/Sarvesh246/jarvis-cloud/releases/download/")
    ).map(asset => ({ name: asset.name, url: asset.browser_download_url, size: asset.size })) });
  } catch (error) { fail(res, error); }
}
