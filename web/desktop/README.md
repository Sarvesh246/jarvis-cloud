# Vaelo desktop

The Tauri application bundles Vaelo's React interface and uses the existing HTTPS
API. Chat, research, reply recovery, approvals, attachments, synchronized history,
and Workroom use the same implementation as the website.

## Development

Install Node.js 24, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system, then run from `web`:

```sh
npm ci
npm run desktop:dev
```

The API is `https://vaelochat.vercel.app`. The Vite server supplies only the local
interface; API credentials stay on the cloud service. Use `npm run desktop:build`
to create installers. `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`
checks the native sign-in callback. Run `npm test` for frontend, API, storage,
authentication, and transport tests.

## Google sign-in

Vaelo opens the system browser at the existing website origin, so the current
Google Web application client and its authorized root redirect URI remain valid.
After Google verifies the account, the browser asks the person to continue to the
desktop app. A one-use, 60-second code is exchanged using an S256 PKCE verifier
held by Rust. The callback listens only on a random loopback port, checks its
Host, path, and random state, and expires after five minutes. Browser cookies and
Google tokens never appear in the callback URL.

Desktop sessions have a separate JWT audience and last seven days. Only verified
desktop bearer sessions can use the native API transport without browser CSRF.
Website requests retain cookie authentication and same-origin CSRF checks.
Sessions are saved in Windows Credential Manager, macOS Keychain, or Linux Secret
Service. A locked or unavailable keyring produces an actionable error; credentials
are never saved in localStorage or a plaintext settings file.

The website must deploy `api/desktop-auth.js` and its server code before desktop
login can work. It uses the existing private Blob store for atomic, single-use
authorization grants. The existing account allowlist still applies.

## Desktop integrations

- External links open in the system browser.
- Downloads use the native Save dialog; write access is limited to selected paths.
- Copy uses the system clipboard. Notifications use the OS permission flow.
- Dropped files and the existing file input share the attachment pipeline.
- Desktop dictation records up to 60 seconds of mono PCM audio, sends it to
  `/api/transcribe`, and inserts the transcript into the editable draft. Audio is
  not saved by Vaelo. Configure `GROQ_API_KEY` or `GEMINI_API_KEY` on the **website**
  service. Browser speech recognition remains unchanged.
- The installed interface and cached conversations open without a network.
  New AI replies, research, sync, and transcription require the cloud service.

On Linux install a Secret Service keyring such as GNOME Keyring or KWallet with
Secret Service enabled. Audio capture requires working WebKitGTK/GStreamer
microphone support. The AppImage bundles media dependencies; Debian/RPM users
need their distribution's GStreamer good plugins and PulseAudio plugin.

## Builds and releases

The Desktop workflow builds Windows x64/ARM64, macOS Intel/Apple silicon, and Linux
x64/ARM64. Branch builds are available as Actions artifacts. A `desktop-vX.Y.Z` tag
matching `src-tauri/tauri.conf.json` builds a **draft GitHub release** with installers
and signed updater artifacts. Publish the draft only after checking the packages.
The download page at `/download` lists published desktop releases.

The updater verification public key is checked in. Its private key belongs in the
`TAURI_SIGNING_PRIVATE_KEY` repository secret, with
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if encrypted. Keep a separate secure backup:
losing the key prevents existing installations from trusting future updates.
Settings provides an explicit check, download, and restart flow.

Apple notarization additionally needs `APPLE_CERTIFICATE` (base64 P12),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`
(app-specific password), and `APPLE_TEAM_ID`. Without these the workflow uses
ad-hoc signing for macOS previews. Windows installers are unsigned until an
Authenticode signing service is configured. Updater signatures verify update
authenticity; they do not replace operating-system publisher certificates.

## Release verification

On each OS, install and launch the actual package, finish Google sign-in in the
system browser, restart to check saved sign-in, and then sign out. Check chat and
research streaming, Stop and reconnect, approval answers, history synchronization,
Workroom documents/checks/import/export, image and text attachments, file drops,
clipboard, exports, microphone permission/recording/transcription, notifications,
offline history, and update checking. A successful cross-platform build does not
prove those interactive checks passed.
