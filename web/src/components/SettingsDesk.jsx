import React, { useEffect, useRef, useState } from "react";
import {
  BellSimple,
  Devices,
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
import { listVoices, onVoices, speak, speechSupport, stopSpeaking } from "../lib/speech.js";
import { InstallSteps } from "./Onboarding.jsx";
import { DesktopUpdates } from "./DesktopUpdates.jsx";
import { Mark } from "./Mark.jsx";
import "./settings-desk.css";

/* Settings for a wide screen: a two-part page in a dialog. Sections down the
   left, the chosen one on the right. Appearance shows a live preview, so a
   choice is judged by looking, not by guessing. Every control here is real:
   each one changes something on this device or what Vaelo is told. */

const SECTIONS = [
  { group: "Look and feel", items: [
    { id: "appearance", label: "Appearance", icon: Palette, words: "paper theme accent color reading size line length density grain motion" },
    { id: "replies", label: "Replies", icon: TextAa, words: "richness adaptive minimal send enter greeting" },
  ] },
  { group: "You", items: [
    { id: "you", label: "Personalization", icon: User, words: "name call about profile remember" },
    { id: "voice", label: "Voice", icon: Microphone, words: "read aloud speech voice speed" },
    { id: "notify", label: "Notifications", icon: BellSimple, words: "notification quiet hours reply ready" },
  ] },
  { group: "System", items: [
    { id: "devices", label: "Devices and help", icon: Devices, words: "device desktop updates install home screen welcome guide sign out" },
    { id: "privacy", label: "Privacy", icon: Lock, words: "location place privacy" },
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

const Switch = ({ id, label, checked, onChange }) => (
  <input id={id} className="sd-switch" type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
);

const Segment = ({ label, value, options, onChange }) => (
  <div className="sd-seg" role="radiogroup" aria-label={label}>
    {options.map(([id, text]) => (
      <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}>
        {text}
      </button>
    ))}
  </div>
);

const Head = ({ title, line }) => (
  <header className="sd-head">
    <h2>{title}</h2>
    <p>{line}</p>
  </header>
);

const Group = ({ title, children }) => (
  <section className="sd-group">
    {title && <h3 className="sd-label">{title}</h3>}
    {children}
  </section>
);

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

function Personal({ prefs, onChange }) {
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

function DevicesHelp({ user, desktop, store, onTools, onWelcome, onSignOut }) {
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

function Privacy({ prefs, place }) {
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

export function SettingsDesk({ open, user, prefs, onChange, onClose, onTools, onWelcome, onSignOut, notify, place, desktop, store }) {
  const dialog = useRef(null);
  const [section, setSection] = useState("appearance");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const words = query.trim().toLowerCase();
  const matches = (item) => !words || `${item.label} ${item.words}`.toLowerCase().includes(words);
  const visible = SECTIONS.map((group) => ({ ...group, items: group.items.filter(matches) })).filter((group) => group.items.length);
  const current = visible.flatMap((group) => group.items).some((item) => item.id === section)
    ? section
    : visible[0]?.items[0]?.id;

  const panels = {
    appearance: <Appearance prefs={prefs} onChange={onChange} />,
    replies: <Replies prefs={prefs} onChange={onChange} />,
    you: <Personal prefs={prefs} onChange={onChange} />,
    voice: <Voice prefs={prefs} onChange={onChange} />,
    notify: <Notify prefs={prefs} onChange={onChange} notify={notify} />,
    devices: <DevicesHelp user={user} desktop={desktop} store={store} onTools={onTools} onWelcome={onWelcome} onSignOut={onSignOut} />,
    privacy: <Privacy prefs={prefs} place={place} />,
    keys: <Keys prefs={prefs} onChange={onChange} />,
  };

  return (
    <dialog
      ref={dialog}
      className="settings-desk"
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
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
              <button key={item.id} type="button" aria-current={current === item.id ? "page" : undefined} className="sd-nav-item" onClick={() => setSection(item.id)}>
                <item.icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {!visible.length && <p className="sd-note">Nothing matches “{query}”.</p>}
        <p className="sd-foot">Appearance is kept on this device. What you tell Vaelo about yourself is sent with your messages.</p>
      </nav>
      <div className="sd-body" key={current}>
        {panels[current]}
      </div>
      <button className="icon-button sd-close" aria-label="Close settings" onClick={onClose}>
        <X size={19} />
      </button>
    </dialog>
  );
}
