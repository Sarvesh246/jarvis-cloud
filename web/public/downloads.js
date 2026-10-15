/* Release asset names are text, never executable HTML. */
(async () => {
  const status = document.getElementById("release-status");
  try {
    const response = await fetch("https://api.github.com/repos/Sarvesh246/jarvis-cloud/releases?per_page=20");
    if (!response.ok) throw new Error("Downloads are available on GitHub.");
    const releases = await response.json();
    const release = releases.find(item => /^desktop-v\d+\.\d+\.\d+$/.test(item.tag_name) && !item.draft && !item.prerelease);
    if (!release) throw new Error("The first desktop release is being prepared.");
    status.textContent = `Vaelo ${release.tag_name.slice(9)}`;
    for (const asset of release.assets) {
      if (!/\.(exe|msi|dmg|deb|rpm|AppImage)$/.test(asset.name) ||
          !asset.browser_download_url.startsWith("https://github.com/Sarvesh246/jarvis-cloud/releases/download/")) continue;
      const platform = /\.(exe|msi)$/.test(asset.name) ? "windows" : /\.dmg$/.test(asset.name) ? "macos" : "linux";
      const arch = /aarch64|arm64/.test(asset.name) ? platform === "macos" ? "Apple silicon" : "ARM64" : platform === "macos" ? "Intel" : "Intel / AMD 64-bit";
      const extension = asset.name.split(".").at(-1);
      const link = document.createElement("a"); link.href = asset.browser_download_url;
      link.textContent = `${arch} · ${extension} · ${Math.round(asset.size / 1048576)} MB`;
      const item = document.createElement("li"); item.append(link); document.getElementById(platform).append(item);
    }
  } catch (error) { status.textContent = error.message || "Downloads are available on GitHub."; }
})();
