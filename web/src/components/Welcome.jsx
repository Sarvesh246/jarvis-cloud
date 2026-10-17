import React from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { Mark } from "./Mark.jsx";
import { firstName, greeting } from "../lib/format.js";
import "./welcome.css";

/* Three ways in, offered as a quiet list. Not cards: nothing here should
   feel like a menu of features. */
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

export function Welcome({ name, phase, onPick }) {
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
