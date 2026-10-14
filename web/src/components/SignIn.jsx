import React from "react";
import { Mark, Wordmark } from "./Mark.jsx";
import "./entry.css";

export function Opening() {
  return (
    <main className="entry">
      <div className="entry-body">
        <Mark size={72} state="thinking" />
        <p role="status" className="entry-line">
          Opening your space…
        </p>
      </div>
    </main>
  );
}

export function SignIn({ configured, error, buttonRef }) {
  return (
    <main className="entry">
      <div className="entry-body">
        <Mark size={84} />
        <Wordmark size={44} />
        <h1>
          Good to see <em>you.</em>
        </h1>
        <p className="entry-line">
          Sign in to pick up where you left off.
        </p>

        {configured ? (
          <div className="google-button" ref={buttonRef} />
        ) : (
          <p className="entry-quiet">
            Sign-in is being set up. Please check back in a little while.
          </p>
        )}

        {error && (
          <p className="entry-error" role="alert">
            {error}{" "}
            <button className="text-button" onClick={() => location.reload()}>
              Try again
            </button>
          </p>
        )}
        <p className="entry-quiet">Private to your Google account.</p>
      </div>
      <footer className="entry-foot">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </footer>
    </main>
  );
}
