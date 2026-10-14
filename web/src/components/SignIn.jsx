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

/* Google's mark, drawn as Google specifies, for our own sign-in button */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function SignIn({
  configured,
  error,
  buttonRef,
  googleState = "loading",
  onRetryGoogle,
  onGoogleRedirect,
}) {
  const own = googleState === "failed" || googleState === "hidden" || googleState === "redirect";
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
          <div className="google-slot" data-state={googleState}>
            <div className="google-button" ref={buttonRef} />
            {googleState === "loading" && (
              <span className="google-placeholder" aria-live="polite">
                Loading Google sign-in…
              </span>
            )}
            {own && (
              <button className="google-own" onClick={onGoogleRedirect}>
                <GoogleG />
                Continue with Google
              </button>
            )}
            {own && googleState !== "redirect" && (
              <p className="google-why">
                Google’s own button was blocked on this browser, so this signs you in on
                Google’s page instead.{" "}
                <button className="text-button" onClick={onRetryGoogle}>
                  Try the button again
                </button>
              </p>
            )}
            {googleState === "ready" && (
              <button className="text-button google-alt" onClick={onGoogleRedirect}>
                Button not showing? Sign in on Google’s page
              </button>
            )}
          </div>
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
