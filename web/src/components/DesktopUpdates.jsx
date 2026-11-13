import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function DesktopUpdates({ store = false }) {
  const [autostart, setAutostart] = useState(false);
  useEffect(() => { invoke("autostart_enabled").then(setAutostart).catch(() => {}); }, []);
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState("");
  const [update, setUpdate] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; getVersion().then(value => { if (active) setVersion(value); }).catch(() => {}); return () => { active = false; }; }, []);
  async function checkNow() {
    setBusy(true); setStatus("Checking for updates…");
    try {
      const found = await check();
      setUpdate(found);
      setStatus(found ? `Vaelo ${found.version} is available.` : `Vaelo ${await getVersion()} is up to date.`);
    } catch { setStatus("Could not check for updates. Check your connection or download a release from GitHub."); }
    finally { setBusy(false); }
  }
  async function install() {
    setBusy(true); setStatus("Downloading update…");
    try {
      await update.downloadAndInstall();
      setStatus("Restarting Vaelo…");
      await relaunch();
    } catch { setStatus("The update could not be installed. Your current version is still available."); setBusy(false); }
  }
  return <fieldset className="settings-group">
    <legend className="label">Desktop updates</legend>
    <label className="settings-note"><input type="checkbox" checked={autostart} onChange={async event => {
      const enabled = event.target.checked;
      try { await invoke("set_autostart", { enabled }); setAutostart(enabled); } catch { setStatus("Could not change startup settings."); }
    }} /> Open Vaelo at sign-in</label>
    <p className="settings-note">Ctrl/Cmd+Shift+Space opens Vaelo from any app. Closing the window keeps it in the tray; choose Quit Vaelo to exit.</p>
    {version && <p className="settings-note">Installed version {version}</p>}
    {store ? <p className="settings-note">Updates are delivered by Microsoft Store.</p> : <button className="text-button" disabled={busy} onClick={update ? install : checkNow}>{update ? `Install ${update.version} and restart` : "Check for updates"}</button>}
    {status && <p className="settings-note" role="status">{status}</p>}
    {!store && <p className="settings-note"><a href="https://github.com/Sarvesh246/jarvis-cloud/releases">All downloads on GitHub</a></p>}
  </fieldset>;
}
