import { DESKTOP, saveDesktopFile } from "./desktop.js";

/* Keep the URL alive long enough for the browser to start the download, even
   when creating, attaching or clicking the anchor fails. Callers own errors. */
export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  let link;
  try {
    link = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(link);
    link.click();
  } finally {
    try { link?.remove(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

/* All text-artifact controls share the same failure boundary. Native dialog
   cancellation is quiet; browser/native failures keep the source available. */
export async function download(name, text, type = "text/plain") {
  try {
    // Excel needs the BOM to recognize Unicode CSV instead of a local code page.
    if (type === "text/csv" && !text.startsWith("\uFEFF")) text = `\uFEFF${text}`;
    if (DESKTOP) return await saveDesktopFile(name, text);
    downloadBlob(name, new Blob([text], { type: `${type};charset=utf-8` }));
    return true;
  } catch {
    // Reporting is best effort too (some embedded browsers disable dialogs).
    try { alert("The file could not be saved. Please try again."); } catch {}
    return false;
  }
}
