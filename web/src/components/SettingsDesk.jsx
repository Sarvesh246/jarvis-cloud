import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BellSimple,
  ArrowLeft,
  Devices,
  Desktop,
  Keyboard,
  Lock,
  MagnifyingGlass,
  Microphone,
  Palette,
  Sparkle,
  TextAa,
  User,
  X,
} from "@phosphor-icons/react";
import { RETENTION_CHOICES } from "../../shared/retention.js";
import { useMemory } from "../lib/use-memory.js";
import {RecallControls} from './RecallSettings.jsx';
import { useRetentionSettings } from "../lib/use-retention.js";
import { listVoices, onVoices, speak, speechSupport, stopSpeaking } from "../lib/speech.js";
import { InstallSteps } from "./Onboarding.jsx";
import { DesktopUpdates } from "./DesktopUpdates.jsx";
import { Mark } from "./Mark.jsx";
import "./settings-desk.css";
import { Segmented, SkeletonCards, EmptyState, UsageMeter } from "./EverydayUI.jsx";

/* Settings for a wide screen: a full page. Sections down the
   left, the chosen one on the right. Appearance shows a live preview, so a
   choice is judged by looking, not by guessing. Every control here is real:
   each one changes something on this device or what Vaelo is told. */

const SECTIONS = [
  { group: "Look and feel", items: [
    { id: "appearance", label: "Appearance", icon: Palette, words: "paper theme accent color reading size line length density grain motion" },
    { id: "replies", label: "Replies", icon: TextAa, words: "richness adaptive minimal send enter greeting" },
  ] },
  { group: "You", items: [
    { id: "you", label: "Personalization", icon: User, words: "name call about profile remember memory notes forget" },
    { id: "voice", label: "Voice", icon: Microphone, words: "read aloud speech voice speed" },
    { id: "notify", label: "Notifications", icon: BellSimple, words: "notification quiet hours reply ready" },
  ] },
  { group: "System", items: [
    { id: "devices", label: "Devices and help", icon: Devices, words: "device devices desktop updates install home screen welcome guide sign out signed in sessions" },
    { id: "privacy", label: "Privacy", icon: Lock, words: "location place privacy history delete retention keep conversations days" },
    { id: "keys", label: "Shortcuts", icon: Keyboard, words: "keyboard shortcuts keys send" },
  ] },
];

const ACCENTS = [
  { id: "gilt", label: "Gilt", light: "#9a6c30", dark: "#dcb47c" },
  { id: "sage", label: "Sage", light: "#5d6e52", dark: "#a9bd9c" },
  { id: "clay", label: "Clay", light: "#9a4b37", dark: "#e3a491" },
  { id: "ink", label: "Ink", light: "#3a302b", dark: "#e2d6c6" },
];

const PAPERS = [
  { id: "light", label: "Parchment", note: "Paper and ink, for daylight" },
  { id: "dark", label: "Lamplight", note: "Warm and low, for evenings" },
  { id: "system", label: "Match system", note: "Changes with your computer" },
];

const Row = ({ title, help, children, htmlFor }) => (
  <div className="sd-row">
    <div className="sd-row-text">
      {htmlFor ? <label htmlFor={htmlFor} className="sd-row-title">{title}</label> : <span className="sd-row-title">{title}</span>}
      {help && <span className="sd-row-help">{help}</span>}
    </div>
    {children}
  </div>
);

const Switch = ({ id, label, checked, onChange, disabled }) => (
  <input id={id} className="sd-switch" type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
);

const Segment = props => <Segmented {...props} />;

const Head = ({ title, line }) => (
  <header className="sd-head">
    <h2 id="settings-section-title">{title}</h2>
    <p>{line}</p>
  </header>
);

const Group = ({ title, children }) => (
  <section className="sd-group">
    {title && <h3 className="sd-label">{title}</h3>}
    {children}
  </section>
);

/* Server-backed settings (devices, memory, history). `request` is the app's
   own fetch helper; it changes identity every render, so it is kept in a ref. */
function useAccount(request, path) {
  const send = useRef(request);
  send.current = request;
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const load = useCallback(async () => {
    try { setState({ status: "ready", data: await send.current(path), error: "" }); }
    catch (error) { setState((last) => ({ status: "failed", data: last.data, error: error.message })); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  const post = useCallback((body) => send.current(path, body), [path]);
  const set = useCallback((data) => setState({ status: "ready", data, error: "" }), []);
  return { ...state, load, post, set };
}

const ago = (time, now = Date.now()) => {
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
};

function Appearance({ prefs, onChange }) {
  const mini = (id) => ({ light: ["#f7f2ea", "#efe7da", "#d6c8b2", "#1c1614"], dark: ["#16110f", "#0e0a09", "#3b302a", "#f6eee3"], system: null }[id]);
  const size = prefs.text === "large" ? 21 : 19;
  const wide = { narrow: "62%", comfortable: "80%", wide: "100%" }[prefs.line];
  return (
    <div className="sd-appearance">
      <div className="sd-appearance-main">
        <Head title="Appearance" line="How the page looks and reads. Changes show at once." />
        <Group title="Paper">
          <div className="sd-papers" role="radiogroup" aria-label="Paper">
            {PAPERS.map((paper) => {
              const colors = mini(paper.id);
              return (
                <button key={paper.id} type="button" role="radio" aria-checked={prefs.theme === paper.id} className="sd-paper" onClick={() => onChange({ theme: paper.id })}>
                  <span className="sd-paper-art" aria-hidden="true" style={colors ? { background: colors[0] } : { background: "linear-gradient(115deg, #f7f2ea 50%, #16110f 50%)" }}>
                    {colors && (
                      <>
                        <span style={{ background: colors[1], borderRight: `1px solid ${colors[2]}` }} />
                        <em style={{ color: colors[3] }}>Good evening.</em>
                      </>
                    )}
                  </span>
                  <span className="sd-paper-name">{paper.label}</span>
                </button>
              );
            })}
          </div>
        </Group>
        <Group title="Accent">
          <div className="sd-accents" role="radiogroup" aria-label="Accent">
            {ACCENTS.map((accent) => (
              <button key={accent.id} type="button" role="radio" aria-checked={prefs.accent === accent.id} className="sd-accent" onClick={() => onChange({ accent: accent.id })}>
                <span aria-hidden="true" style={{ background: `light-dark(${accent.light}, ${accent.dark})` }} />
                {accent.label}
              </button>
            ))}
          </div>
          <p className="sd-note">Used for Vaelo’s mark, the send button and highlights. Your own messages stay neutral.</p>
        </Group>
        <Group title="Reading">
          <Row title="Reply size" help={prefs.text === "large" ? "Larger, easier on the eyes" : "The default, 19px"}>
            <Segment label="Reply size" value={prefs.text} options={[["standard", "Standard"], ["large", "Larger"]]} onChange={(text) => onChange({ text })} />
          </Row>
          <Row title="Line length" help="How wide the reading column may grow">
            <Segment label="Line length" value={prefs.line} options={[["narrow", "Narrow"], ["comfortable", "Comfortable"], ["wide", "Wide"]]} onChange={(line) => onChange({ line })} />
          </Row>
          <Row title="Density" help="Spacing in the rail and the conversation">
            <Segment label="Density" value={prefs.density} options={[["compact", "Compact"], ["comfortable", "Comfortable"]]} onChange={(density) => onChange({ density })} />
          </Row>
          <Row title="Paper grain" help="A faint texture on the page" htmlFor="sd-grain">
            <Switch id="sd-grain" label="Paper grain" checked={prefs.grain} onChange={(grain) => onChange({ grain })} />
          </Row>
          <Row title="Reduce motion" help="Keeps every state, drops the movement. Independent of your system." htmlFor="sd-motion">
            <Switch id="sd-motion" label="Reduce motion" checked={prefs.motion === "reduce"} onChange={(on) => onChange({ motion: on ? "reduce" : "system" })} />
          </Row>
        </Group>
      </div>
      <aside className="sd-preview" aria-label="Preview">
        <span className="sd-label">Preview</span>
        <div className="sd-preview-me">What should I pack first?</div>
        <div className="sd-preview-reply">
          <Mark size={26} />
          <p style={{ fontSize: `${size}px`, maxWidth: wide }}>
            Start with the things you use least: books, spare linens, the winter coats. Leave the kettle for last.
          </p>
        </div>
        <span className="sd-preview-send" aria-hidden="true">↑</span>
      </aside>
    </div>
  );
}

function Replies({ prefs, onChange }) {
  return (
    <div className="sd-page">
      <Head title="Replies" line="How Vaelo shapes and shows what it writes." />
      <Group title="Richness">
        <div className="sd-cards" role="radiogroup" aria-label="Richness">
          {[
            ["adaptive", "Adaptive", "Tables you can sort, charts when numbers say something, checklists you can tick. Controls run locally."],
            ["minimal", "Minimal", "Plain, well-set prose and tables. Nothing moves or opens on its own."],
          ].map(([id, title, note]) => (
            <button key={id} type="button" role="radio" aria-checked={prefs.presentation === id} className="sd-card" onClick={() => onChange({ presentation: id })}>
              <span className="sd-card-title">{title}</span>
              <span className="sd-card-note">{note}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Writing">
        <Row title="Send a message with" help="The other key adds a new line">
          <Segment label="Send key" value={prefs.sendKey} options={[["enter", "Enter"], ["mod-enter", "Ctrl Enter"]]} onChange={(sendKey) => onChange({ sendKey })} />
        </Row>
        <Row title="Greet me by time of day" help="“Good evening.” on the desk, or a plain “Hello.”" htmlFor="sd-greet">
          <Switch id="sd-greet" label="Greet me by time of day" checked={prefs.greet} onChange={(greet) => onChange({ greet })} />
        </Row>
      </Group>
    </div>
  );
}

function Memory({ request }) {
  const memory = useMemory(request);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);
  const { problem, busy, run } = memory;
  if (memory.status === "loading") return <Group title="Memory"><SkeletonCards label="Loading memory" /></Group>;
  if (!memory.data) return <Group title="Memory"><EmptyState error title="Memory is unavailable" action="Try again" onAction={memory.load}>{memory.error}</EmptyState></Group>;
  const { enabled, items } = memory.data;
  return (
    <Group title="Memory">
      <Row title="Let Vaelo note lasting facts" help="When you say “remember that…” or share something that will stay true, Vaelo saves one short note and says so in its reply. Never from replies that used the web or your files." htmlFor="sd-memory">
        <Switch id="sd-memory" label="Let Vaelo note lasting facts" checked={enabled} disabled={busy} onChange={(next) => run({ action: "enable", enabled: next })} />
      </Row>
      <p className="sd-note">Notes are kept with your account, so every device shares them, and they are sent with your messages while this is on. {items.length} of 40 used.</p>
      <RecallControls memory={memory} request={request}/>
      {!items.length && <p className="sd-note">Nothing noted yet.</p>}
      <ul className="sd-notes">
        {items.map((item) => (
          <li key={item.id} className="sd-memo">
            {editing?.id === item.id ? (
              <form className="sd-memo-edit" onSubmit={async (event) => { event.preventDefault(); if (await run({ action: "edit", id: item.id, text: editing.text })) setEditing(null); }}>
                <label className="sr-only" htmlFor={`sd-edit-${item.id}`}>Edit note</label>
                <input id={`sd-edit-${item.id}`} className="sd-input" type="text" maxLength={280} value={editing.text} disabled={busy} autoFocus onChange={(event) => setEditing({ id: item.id, text: event.target.value })} />
                <button type="submit" className="sd-button" disabled={busy}>Save</button>
                <button type="button" className="sd-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span className="sd-row-text">
                  <span className="sd-row-title">{item.text}</span>
                  <span className="sd-row-help">{item.source === "vaelo" ? "Noted by Vaelo" : "Added by you"} · {ago(item.updated)}</span>
                </span>
                <button type="button" className="sd-button" disabled={busy} onClick={() => setEditing({ id: item.id, text: item.text })}>Edit</button>
                <button type="button" className="sd-button" data-tone="clay" disabled={busy} aria-label={`Delete note: ${item.text}`} onClick={() => run({ action: "remove", id: item.id })}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="sd-memo-add" onSubmit={async (event) => { event.preventDefault(); if (draft.trim() && await run({ action: "add", text: draft })) setDraft(""); }}>
        <label className="sr-only" htmlFor="sd-memo-new">Add a note</label>
        <input id="sd-memo-new" className="sd-input" type="text" maxLength={280} value={draft} disabled={busy} placeholder="Add something for Vaelo to remember" onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="sd-button" disabled={busy || !draft.trim()}>Add</button>
      </form>
      {problem && <p className="sd-note" data-tone="problem" role="alert">{problem}</p>}
    </Group>
  );
}

function Personal({ prefs, onChange, request, guest, accountId }) {
  return (
    <div className="sd-page">
      <Head title="Personalization" line="What Vaelo knows about you, and how it speaks to you." />
      <Group title="About you">
        <div className="sd-field">
          <label htmlFor="sd-call">What should Vaelo call you?</label>
          <input id="sd-call" className="sd-input" type="text" maxLength={40} value={prefs.callMe} placeholder="Your first name" onChange={(event) => onChange({ callMe: event.target.value })} />
        </div>
        <div className="sd-field">
          <label htmlFor="sd-about">Anything Vaelo should keep in mind</label>
          <textarea id="sd-about" className="sd-input sd-area" rows={5} maxLength={600} value={prefs.about} placeholder="Your work, the people you often mention, how you like answers…" onChange={(event) => onChange({ about: event.target.value })} />
          <span className="sd-note">{prefs.about.length} of 600. Sent with each message you write, and never shown back to you. Kept on this device.</span>
        </div>
      </Group>
      {!guest && <Memory key={accountId} request={request} />}
    </div>
  );
}

function Voice({ prefs, onChange }) {
  const [voices, setVoices] = useState(() => listVoices());
  useEffect(() => onVoices(() => setVoices(listVoices())), []);
  if (!speechSupport())
    return (
      <div className="sd-page">
        <Head title="Voice" line="Vaelo reading replies aloud." />
        <p className="sd-note">This browser can’t read aloud.</p>
      </div>
    );
  return (
    <div className="sd-page">
      <Head title="Voice" line="Vaelo reading replies aloud, in a voice from your own device." />
      <Group>
        <Row title="Read replies aloud" help="Each reply is read when it finishes. Code and tables are left out." htmlFor="sd-aloud">
          <Switch id="sd-aloud" label="Read replies aloud" checked={prefs.readAloud} onChange={(readAloud) => { if (!readAloud) stopSpeaking(); onChange({ readAloud }); }} />
        </Row>
        <Row title="Voice" help="Voices installed on this device" htmlFor="sd-voice">
          <div className="sd-inline">
            <select id="sd-voice" className="sd-input" value={prefs.voice} onChange={(event) => onChange({ voice: event.target.value })}>
              <option value="">Device default</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>
              ))}
            </select>
            <button type="button" className="sd-button" onClick={() => speak("This is how Vaelo will sound when it reads to you.", { voice: prefs.voice, rate: prefs.rate })}>
              Play sample
            </button>
          </div>
        </Row>
        <Row title="Speed" help={`${prefs.rate.toFixed(2).replace(/0$/, "")}×`} htmlFor="sd-rate">
          <input id="sd-rate" className="sd-range" type="range" min="0.75" max="1.5" step="0.05" value={prefs.rate} onChange={(event) => onChange({ rate: Number(event.target.value) })} />
        </Row>
      </Group>
    </div>
  );
}

function Notify({ prefs, onChange, notify }) {
  return (
    <div className="sd-page">
      <Head title="Notifications" line="Only when you’ve switched away. Never while you’re reading." />
      <Group title="Tell me when">
        {notify.support === "available" ? (
          <Row title="A reply finishes" help="Only when Vaelo finishes while this window is in the background." htmlFor="sd-ready">
            <Switch id="sd-ready" label="Tell me when a reply is ready" checked={prefs.notify} onChange={notify.toggle} />
          </Row>
        ) : (
          <p className="sd-note">
            {notify.support === "install"
              ? "Add Vaelo to your Home Screen (Share → Add to Home Screen) to be told when a reply is ready."
              : "This browser can’t tell you when a reply is ready. The tab title still changes."}
          </p>
        )}
        {notify.problem && <p className="sd-note" data-tone="problem" role="alert">{notify.problem}</p>}
      </Group>
      <Group title="Quiet hours">
        <Row title="Hold notifications overnight" help="Replies that finish in this window won’t notify. The tab title still changes." htmlFor="sd-quiet">
          <Switch id="sd-quiet" label="Hold notifications during quiet hours" checked={prefs.quiet} onChange={(quiet) => onChange({ quiet })} />
        </Row>
        <div className="sd-times" data-off={!prefs.quiet || undefined}>
          <span>From</span>
          <label className="sr-only" htmlFor="sd-from">Quiet hours start</label>
          <input id="sd-from" className="sd-input" type="time" disabled={!prefs.quiet} value={prefs.quietFrom} onChange={(event) => event.target.value && onChange({ quietFrom: event.target.value })} />
          <span>to</span>
          <label className="sr-only" htmlFor="sd-to">Quiet hours end</label>
          <input id="sd-to" className="sd-input" type="time" disabled={!prefs.quiet} value={prefs.quietTo} onChange={(event) => event.target.value && onChange({ quietTo: event.target.value })} />
        </div>
      </Group>
    </div>
  );
}

function DeviceList({ request }) {
  const devices = useAccount(request, "/api/session?resource=devices");
  const [busy, setBusy] = useState("");
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState("");
  const act = async (body) => {
    setBusy(body.id || "others"); setProblem("");
    try { await devices.post(body); setSure(false); await devices.load(); }
    catch (error) { setProblem(error.message); }
    finally { setBusy(""); }
  };
  if (devices.status === "loading") return <SkeletonCards label="Loading signed-in devices" />;
  if (!devices.data) return <><p className="sd-note" data-tone="problem" role="alert">{devices.error || "Devices are unavailable right now."}</p><button type="button" className="sd-button" onClick={devices.load}>Try again</button></>;
  if (!devices.data.available) return <p className="sd-note">This Vaelo doesn’t keep a list of devices.</p>;
  const { current, devices: list } = devices.data;
  const others = list.filter((device) => !device.current);
  return (
    <>
      {!current && <p className="sd-note">This session started before devices were listed. Sign out and back in on this device to see and manage the others.</p>}
      {list.map((device) => (
        <div className="sd-device" key={device.id}>
          <span className="sd-device-icon" aria-hidden="true">{device.kind === "desktop" ? <Desktop size={24} /> : <Devices size={24} />}</span>
          <span className="sd-row-text">
            <span className="sd-row-title">{device.label}{device.current ? " · this device" : ""}</span>
            <span className="sd-row-help">Signed in {ago(device.created)} · {device.current ? "active now" : `last active ${ago(device.seen)}`}</span>
          </span>
          {!device.current && (
            <button type="button" className="sd-button" data-tone="clay" disabled={Boolean(busy)} aria-label={`Sign out ${device.label}`} onClick={() => act({ action: "revoke", id: device.id })}>
              {busy === device.id ? "Signing out…" : "Sign out"}
            </button>
          )}
        </div>
      ))}
      {current && others.length > 0 && (sure ? (
        <div className="sd-confirm" role="alert">
          <p>Every other device will be asked to sign in again. This one stays signed in.</p>
          <div className="sd-inline">
            <button type="button" className="sd-button" data-tone="clay" disabled={Boolean(busy)} onClick={() => act({ action: "revoke-others" })}>{busy === "others" ? "Signing out…" : "Sign out all others"}</button>
            <button type="button" className="sd-button" onClick={() => setSure(false)}>Cancel</button>
          </div>
        </div>
      ) : <Row title="Sign out everywhere else" help="Ends every other session. Other devices notice within a few seconds."><button type="button" className="sd-button" data-tone="clay" onClick={() => setSure(true)}>Sign out others</button></Row>)}
      {problem && <p className="sd-note" data-tone="problem" role="alert">{problem}</p>}
    </>
  );
}

function DevicesHelp({ user, desktop, store, request, onTools, onWelcome, onSignOut }) {
  const guest = !!user?.guest;
  return (
    <div className="sd-page">
      <Head title="Devices and help" line="Where Vaelo runs on this computer, and a way back to the guide." />
      <Group title="This device">
        <div className="sd-device">
          <span className="sd-device-icon" aria-hidden="true"><Devices size={24} /></span>
          <span className="sd-row-text">
            <span className="sd-row-title">{desktop ? "Vaelo for desktop" : "This browser"}</span>
            <span className="sd-row-help">{guest ? "Guest · nothing is saved after you close this tab" : `Signed in as ${user?.name}`}</span>
          </span>
          <button type="button" className="sd-button" data-tone="clay" onClick={onSignOut}>{guest ? "Leave guest mode" : "Sign out"}</button>
        </div>
      </Group>
      {!guest && <Group title="Signed-in devices"><DeviceList request={request} /><p className="sd-note">“Sign out” above ends every session of this kind on every device, so use it if a device is lost and you can’t tell which one it was.</p></Group>}
      {desktop && <Group title="Updates"><DesktopUpdates store={store} /></Group>}
      {!desktop && (
        <Group title="Add to home screen">
          <p className="sd-note">It opens without browser bars, and saved conversations stay readable offline.</p>
          <InstallSteps />
        </Group>
      )}
      <Group title="Help">
        <Row title="Show the welcome again" help="The short tour you saw when you first signed in"><button type="button" className="sd-button" onClick={onWelcome}><Sparkle size={16} aria-hidden="true" /> Show it</button></Row>
        {onTools && <Row title="QR link and interface guide" help="Open Vaelo on your phone, and learn the controls"><button type="button" className="sd-button" onClick={onTools}>Open</button></Row>}
      </Group>
    </div>
  );
}

function History({ request, onRetention }) {
  const history = useRetentionSettings(request, onRetention);
  const [pending, setPending] = useState(null);
  const { busy, problem } = history;
  const save = async (days, confirm) => {
    if (await history.run({ days, ...(confirm && { confirm: true }) })) setPending(null);
  };
  if (history.status === "loading") return <Group title="Conversation history"><SkeletonCards label="Loading conversation history" /></Group>;
  if (!history.data) return <Group title="Conversation history"><p className="sd-note" data-tone="problem" role="alert">{history.error || "History settings are unavailable right now."}</p><button type="button" className="sd-button" onClick={history.load}>Try again</button></Group>;
  const days = history.data.days;
  return (
    <Group title="Conversation history">
      <Row title="Keep conversations for" help={days ? `Older than ${days} days are deleted` : "Nothing is deleted automatically"}>
        <Segment label="Keep conversations for" disabled={busy} value={String(pending ?? days)} options={[["0", "Forever"], ...RETENTION_CHOICES.map((choice) => [String(choice), `${choice} days`])]}
          onChange={(value) => { const next = Number(value); if (next === 0) { setPending(null); if (days) save(0); } else setPending(next === days ? null : next); }} />
      </Row>
      {pending && (
        <div className="sd-confirm" role="alert">
          <p><strong>This deletes conversations for good.</strong> Anything not touched in {pending} days is removed from this device, from every other device you’re signed in on, and from the cloud copy. It can’t be undone. Pinned conversations, the one you have open and any reply being written are always kept.</p>
          <div className="sd-inline">
            <button type="button" className="sd-button" data-tone="clay" disabled={busy} onClick={() => save(pending, true)}>{busy ? "Saving…" : `Delete after ${pending} days`}</button>
            <button type="button" className="sd-button" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {problem && <p className="sd-note" data-tone="problem" role="alert">{problem}</p>}
      <p className="sd-note">Checked in the background while Vaelo is open, a few at a time, oldest first. Every device follows the same choice.</p>
    </Group>
  );
}

function Privacy({ prefs, place, request, guest, onRetention }) {
  return (
    <div className="sd-page">
      <Head title="Privacy" line="What Vaelo may know about where you are." />
      <Group title="Where you are">
        {place.support ? (
          <Row title="Use my location" help={place.note} htmlFor="sd-place">
            <Switch id="sd-place" label="Use my location" checked={prefs.location} onChange={place.toggle} />
          </Row>
        ) : (
          <p className="sd-note">This browser can’t share a location.</p>
        )}
        {place.problem && <p className="sd-note" data-tone="problem" role="alert">{place.problem}</p>}
      </Group>
      {!guest && <History request={request} onRetention={onRetention} />}
    </div>
  );
}

function Keys({ prefs, onChange }) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const keys = [
    ["Find an action, a conversation or something saved", [mod, "K"]],
    ["Show or hide the sidebar", [mod, "\\"]],
    ["Jump to the message box", ["/"]],
    prefs.sendKey === "mod-enter" ? ["Send a message", [mod, "Enter"]] : ["Send a message", ["Enter"]],
    prefs.sendKey === "mod-enter" ? ["New line in a message", ["Enter"]] : ["New line in a message", ["Shift", "Enter"]],
    ["Stop a reply, or close the workspace", ["Esc"]],
  ];
  return (
    <div className="sd-page">
      <Head title="Shortcuts" line="Everything here is also in the command palette." />
      <Group title="Sending">
        <Row title="Send a message with" help="The other key adds a new line">
          <Segment label="Send key" value={prefs.sendKey} options={[["enter", "Enter"], ["mod-enter", "Ctrl Enter"]]} onChange={(sendKey) => onChange({ sendKey })} />
        </Row>
      </Group>
      <Group title="Everywhere">
        {keys.map(([label, combo]) => (
          <div className="sd-row sd-key" key={label}>
            <span className="sd-row-title">{label}</span>
            <span className="sd-combo">{combo.map((key) => <kbd key={key}>{key}</kbd>)}</span>
          </div>
        ))}
      </Group>
    </div>
  );
}

export function SettingsDesk({ open, user, prefs, onChange, onClose, onTools, onWelcome, onSignOut, notify, place, desktop, store, request, onRetention }) {
  const page = useRef(null);
  const body = useRef(null);
  const returnFocus = useRef(null);
  const wasOpen = useRef(false);
  const [present, setPresent] = useState(open);
  const [section, setSection] = useState("appearance");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement;
      setPresent(true);
      wasOpen.current = true;
    } else if (wasOpen.current) {
      queueMicrotask(() => returnFocus.current?.focus?.({ preventScroll: true }));
      const timer = setTimeout(() => setPresent(false), 480);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (open && present) page.current?.focus({ preventScroll: true });
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    const keys = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], .sheet-layer")) return;
      event.preventDefault();
      onClose();
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, [open, onClose]);

  const words = query.trim().toLowerCase();
  const matches = (item) => !words || `${item.label} ${item.words}`.toLowerCase().includes(words);
  const visible = SECTIONS.map((group) => ({ ...group, items: group.items.filter(matches) })).filter((group) => group.items.length);
  const current = visible.flatMap((group) => group.items).some((item) => item.id === section)
    ? section
    : visible[0]?.items[0]?.id;

  const [shown, setShown] = useState(current);
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [shown]);
  const leaving = current !== shown;
  useEffect(() => {
    if (!leaving) return;
    const reduced = prefs.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setShown(current), reduced ? 0 : 110);
    return () => clearTimeout(timer);
  }, [current, leaving, prefs.motion]);

  const panels = {
    appearance: <Appearance prefs={prefs} onChange={onChange} />,
    replies: <Replies prefs={prefs} onChange={onChange} />,
    you: <Personal prefs={prefs} onChange={onChange} request={request} guest={!!user?.guest} accountId={user?.sub} />,
    voice: <Voice prefs={prefs} onChange={onChange} />,
    notify: <Notify prefs={prefs} onChange={onChange} notify={notify} />,
    devices: <DevicesHelp user={user} desktop={desktop} store={store} request={request} onTools={onTools} onWelcome={onWelcome} onSignOut={onSignOut} />,
    privacy: <Privacy key={user?.sub || "guest"} prefs={prefs} place={place} request={request} guest={!!user?.guest} onRetention={onRetention} />,
    keys: <Keys prefs={prefs} onChange={onChange} />,
  };

  if (!present) return null;

  return (
    <main
      ref={page}
      className="settings-desk"
      data-open={open}
      aria-labelledby="settings-title"
      tabIndex={-1}
      inert={open ? undefined : true}
    >
      <header className="sd-topbar">
        <button type="button" className="sd-back" onClick={onClose}>
          <ArrowLeft size={20} aria-hidden="true" /> Back to Vaelo
        </button>
        <span className="sd-autosave">Changes save automatically</span>
        <button type="button" className="icon-button sd-close" aria-label="Close settings" onClick={onClose}>
          <X size={21} aria-hidden="true" />
        </button>
      </header>
      <nav className="sd-nav" aria-label="Settings sections">
        <h1 id="settings-title">Settings</h1>
        <label className="sd-search">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" value={query} placeholder="Search settings" aria-label="Search settings" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {visible.map((group) => (
          <div key={group.group} className="sd-nav-group">
            <span className="sd-label">{group.group}</span>
            {group.items.map((item) => (
              <button key={item.id} type="button" aria-current={current === item.id ? "page" : undefined} aria-controls="settings-content" className="sd-nav-item" onClick={() => setSection(item.id)}>
                <item.icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {!visible.length && <p className="sd-note">Nothing matches “{query}”.</p>}
        <p className="sd-foot">Appearance is kept on this device. What you tell Vaelo about yourself is sent with your messages.</p>
      </nav>
      <div ref={body} className="sd-body" id="settings-content">
        <div className="sd-content" key={shown} data-leaving={leaving} inert={leaving ? true : undefined}>
          {panels[shown] || <div className="sd-page"><Head title="No matching settings" line="Try a different search to find a setting." /></div>}
        </div>
      </div>
    </main>
  );
}
