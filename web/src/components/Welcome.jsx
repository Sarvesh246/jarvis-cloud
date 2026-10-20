import React from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Mark } from "./Mark.jsx";
import { firstName, greeting, previewOf, timeLabel } from "../lib/format.js";
import "./welcome.css";
import { usePhone } from "../lib/use-phone.js";

/* Ways in, offered as quiet chips under the message box. Not cards: nothing
   here should feel like a menu of features. */
export const starters = [
  {
    title: "Think something through",
    note: "A question, with sources that hold up.",
    text: "Help me research a topic. First ask what I want to understand, then find reliable sources and explain what matters.",
    research: true,
  },
  {
    title: "Make something",
    note: "Practical, one step at a time.",
    text: "Help me build something useful. Ask what I have in mind, then work through a practical implementation with me.",
  },
  {
    title: "Find a way forward",
    note: "Turn an idea into a plan.",
    text: "Help me turn an idea into a practical plan. Start by asking what I want to achieve and what constraints matter.",
  },
];

const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/* The desk: the date, Vaelo's face and a greeting, the message box right
   under them, then ways to begin, where you left off and what is waiting on
   you. `dock` is the message box itself, so it is the real composer, not a
   picture of one. */
export function Welcome({ name, phase, onPick, recent = [], onOpen, plain = false, dock, status, waiting = [], onWorkroom }) {
  const phone = usePhone();
  if (phone) return <PhoneWelcome name={name} phase={phase} onPick={onPick} />;
  const who = firstName(name);
  return (
    <section className="welcome" aria-label="Start a conversation">
      <p className="desk-meta">
        <span>{today()}</span>
        {status && (
          <>
            <span className="desk-meta-rule" aria-hidden="true" />
            <span className="desk-status" data-tone={status.tone}>
              <span className="desk-status-dot" aria-hidden="true" />
              {status.text}
            </span>
          </>
        )}
      </p>
      <Mark size={64} state={phase} />
      <h1 className="kinetic-greeting">
        {plain ? "Hello" : greeting()}
        {who ? (
          <>
            , <em>{who}.</em>
          </>
        ) : (
          "."
        )}
      </h1>
      <p className="welcome-line">What would you like to take care of?</p>
      {dock}
      <div className="starter-chips" role="group" aria-label="Start with">
        <span className="starter-chips-label">Start with</span>
        {starters.map((starter) => (
          <button key={starter.title} title={starter.note} onClick={() => onPick(starter.text, { research: !!starter.research })}>
            {starter.title}
          </button>
        ))}
        {onWorkroom && <button onClick={onWorkroom}>Draft from my files</button>}
      </div>
      {(recent.length > 0 || waiting.length > 0) && (
        <div className="desk-lower" data-two={(recent.length > 0 && waiting.length > 0) || undefined}>
          {recent.length > 0 && onOpen && (
            <section className="welcome-recent" aria-labelledby="welcome-recent-h">
              <h2 id="welcome-recent-h" className="label">
                Pick up where you left off
              </h2>
              <ul>
                {recent.map((chat) => (
                  <li key={chat.id}>
                    <button className="recent-row" onClick={() => onOpen(chat.id)}>
                      <span className="recent-text">
                        <span className="recent-title">{chat.title}</span>
                        <span className="recent-excerpt">{previewOf(chat)}</span>
                      </span>
                      <span className="recent-when">{timeLabel(chat.updated)}</span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {waiting.length > 0 && onOpen && (
            <aside className="desk-waiting" aria-labelledby="desk-waiting-h">
              <h2 id="desk-waiting-h" className="label">
                Waiting on you
              </h2>
              {waiting.map((item) => (
                <div key={item.id} className="desk-waiting-card">
                  <Mark size={26} />
                  <div>
                    <p>{item.what || "Vaelo needs your answer before it goes on."}</p>
                    <span className="desk-waiting-from">In “{item.title}”</span>
                    <button className="desk-waiting-go" onClick={() => onOpen(item.id)}>
                      Review and answer
                    </button>
                  </div>
                </div>
              ))}
            </aside>
          )}
        </div>
      )}
      <p className="welcome-foot">
        Vaelo can make mistakes. Where it matters, it shows its sources so you can check.
      </p>
    </section>
  );
}

/* The phone welcome from d864aef, with its composer fixed below the page. */
function PhoneWelcome({ name, phase, onPick }) {
  const who = firstName(name);
  return (
    <section className="welcome" aria-label="Start a conversation">
      <Mark size={64} state={phase} />
      <h1 className="kinetic-greeting">
        {greeting()}
        {who ? (
          <>
            , <em>{who}.</em>
          </>
        ) : (
          "."
        )}
      </h1>
      <p className="welcome-line">What would you like to take care of?</p>
      <ul className="starters">
        {starters.map((starter, index) => (
          <li key={starter.title}>
            <button onClick={() => onPick(starter.text, { research: !!starter.research })}>
              <span className="starter-index" aria-hidden="true">
                {["i", "ii", "iii"][index]}.
              </span>
              <span className="starter-title">{starter.title}</span>
              <span className="starter-note">{starter.note}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="welcome-foot">
        Vaelo can make mistakes. Where it matters, it shows its sources so you can check.
      </p>
    </section>
  );
}
