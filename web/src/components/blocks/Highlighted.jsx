import React from "react";
import { Highlight } from "prism-react-renderer";
import { Prism } from "./prism.js";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-ruby";

/* Code is set in ink with one accent: the whole palette is drawn from gilt,
   so a snippet reads as part of the page rather than a pasted-in editor.
   The colours live in tokens.css (--code-*) and follow the chosen paper. */

const ALIAS = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  cs: "csharp",
  "c#": "csharp",
  rb: "ruby",
  "c++": "cpp",
  golang: "go",
  rs: "rust",
  yml: "yaml",
  htm: "html",
};

const token = (name) => `var(--code-${name})`;

const THEME = {
  plain: { color: token("plain"), backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: token("comment"), fontStyle: "italic" } },
    { types: ["keyword", "tag", "selector", "important", "atrule", "rule"], style: { color: token("keyword") } },
    { types: ["function", "class-name", "attr-name", "property", "builtin", "maybe-class-name"], style: { color: token("name") } },
    { types: ["string", "char", "attr-value", "regex", "url", "inserted", "template-string"], style: { color: token("string") } },
    { types: ["number", "boolean", "constant", "symbol", "unit", "deleted", "entity"], style: { color: token("number") } },
    { types: ["punctuation", "operator"], style: { color: token("punctuation") } },
    { types: ["variable", "parameter"], style: { color: token("plain") } },
  ],
};

export function grammarFor(language) {
  const name = ALIAS[language] || language;
  return name && Prism.languages[name] ? name : "";
}

/* Highlighted lines for a <pre>. Unknown languages stay plain ink. */
export function Highlighted({ source, language }) {
  const grammar = grammarFor(language);
  if (!grammar) return <code>{source}</code>;
  return (
    <Highlight prism={Prism} code={source} language={grammar} theme={THEME}>
      {({ tokens, getTokenProps }) => (
        <code className={`language-${grammar}`}>
          {tokens.map((line, i) => (
            <React.Fragment key={i}>
              {line.map((part, j) => {
                const { key: _key, ...props } = getTokenProps({ token: part });
                return <span key={j} {...props} />;
              })}
              {i < tokens.length - 1 && "\n"}
            </React.Fragment>
          ))}
        </code>
      )}
    </Highlight>
  );
}
