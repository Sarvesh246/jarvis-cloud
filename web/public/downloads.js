/* Release asset names are text, never executable HTML. */
(async () => {
  const status = document.getElementById("release-status");
  try {
    const response = await fetch("/api/desktop-release");
    const release = await response.json();
    if (!response.ok) throw new Error(release.error);
    status.textContent = `Vaelo ${release.version}`;
    for (const asset of release.assets) {
      const platform = /\.(exe|msi)$/.test(asset.name) ? "windows" : /\.dmg$/.test(asset.name) ? "macos" : "linux";
      const arch = /aarch64|arm64/.test(asset.name) ? platform === "macos" ? "Apple silicon" : "ARM64" : platform === "macos" ? "Intel" : "Intel / AMD 64-bit";
      const extension = asset.name.split(".").at(-1);
      const link = document.createElement("a"); link.href = asset.url;
      link.textContent = `${arch} · ${extension} · ${Math.round(asset.size / 1048576)} MB`;
      const item = document.createElement("li"); item.append(link); document.getElementById(platform).append(item);
    }
  } catch (error) { status.textContent = error.message || "Downloads are available on GitHub."; }
})();
