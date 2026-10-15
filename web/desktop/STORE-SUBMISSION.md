# Microsoft Store submission

Product: Vaelo Chat
Store ID: 9PDKBBJC8MVN
Package name: SarveshJagtap.VaeloChat
Publisher: CN=44A9A620-E275-4874-B56B-F2898060D750
Publisher display name: Sarvesh Jagtap

Upload both `Vaelo_0.1.0.0_x64.msix` and `Vaelo_0.1.0.0_arm64.msix` from the
GitHub release to the MSIX application's Packages section in Partner Center.
These packages are unsigned for Store submission; Microsoft signs accepted
packages. Do not upload the GitHub EXE/MSI installers to this product type.

Suggested listing description:

> Vaelo is a calm, capable space for questions, ideas, and everyday work. Chat,
> explore a topic with research and sources, and organize reusable briefs and
> documents in Workroom. Sign in with Google to keep conversations and work in
> sync across devices. Attach images or text files, dictate a draft, copy useful
> answers, and save documents, code, and tables to your computer.
>
> An internet connection is required for AI replies, research, synchronization,
> and dictation. Saved conversations can be read offline. Access is currently
> restricted to the configured Vaelo workspace account.

Privacy policy: https://vaelochat.vercel.app/privacy
Support: sarveshvjagtap@gmail.com
Website: https://vaelochat.vercel.app

Certification notes:

- `runFullTrust` is required by the Tauri/Rust desktop host for the system
  browser, loopback Google sign-in callback, credential store, file dialogs,
  clipboard, and notifications. The app does not provide arbitrary shell access.
- Microphone access is used only after the person starts dictation. Audio is
  sent to the cloud speech provider and inserted as an editable transcript.
- Store builds receive updates through Microsoft Store and disable the GitHub
  updater interface.
- Google sign-in opens the system browser and returns through a temporary
  loopback callback. No Microsoft login is required.
- The reviewer needs an allowed Google account. The current owner-only account
  restriction must be resolved with a deliberate access policy and reviewer
  access before a public Store submission can pass certification.

Complete the Store's content ratings, market/availability settings, listing
screenshots, and reviewer access. Validate on clean x64 and ARM64 Windows
installations, including the Evergreen WebView2 prerequisite, before submitting.
