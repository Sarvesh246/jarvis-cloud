import React, { useState } from "react";
import { clearDesktopHandoff } from "../lib/desktop-handoff.js";
import { Mark } from "./Mark.jsx";

export function DesktopHandoff({ pending, session, onCancel }) {
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  async function approve() {
    setBusy(true); setProblem("");
    try {
      const response = await fetch("/api/desktop-auth", {
        method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
        body: JSON.stringify({ action: "authorize", challenge: pending.challenge }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in could not be completed.");
      clearDesktopHandoff();
      location.replace(`http://127.0.0.1:${pending.port}/callback?${new URLSearchParams({ code: data.code, state: pending.state })}`);
    } catch (error) { setProblem(error.message); setBusy(false); }
  }
  return <main className="entry"><div className="entry-body">
    <Mark phase="idle" />
    <h1>Continue to Vaelo desktop</h1>
    <p>Sign in to the desktop app as {session.user.email}.</p>
    <p>Continue only if you just opened sign-in from the Vaelo application.</p>
    <button className="google-own" disabled={busy} onClick={approve}>{busy ? "Opening Vaelo…" : "Continue to Vaelo"}</button>
    <button className="text-button" disabled={busy} onClick={() => { clearDesktopHandoff(); onCancel(); }}>Cancel</button>
    {problem && <p role="alert">{problem}</p>}
  </div></main>;
}
