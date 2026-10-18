import React, { useMemo, useState } from "react";
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
export function Highlighted({ source, language, lineNumbers = false, foldAll = false }) {
  const grammar = grammarFor(language);
  if (!grammar) return <code>{lineNumbers ? source.split('\n').map((line, i, lines) => <span key={i} className="code-line"><span className="code-line-number" aria-hidden="true">{i + 1}</span>{line}{i < lines.length - 1 ? '\n' : ''}</span>) : source}</code>;
  return (
    <Highlight prism={Prism} code={source} language={grammar} theme={THEME}>
      {({ tokens, getTokenProps }) => lineNumbers ? <CodeLines tokens={tokens} getTokenProps={getTokenProps} grammar={grammar} foldAll={foldAll} /> : (
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

function CodeLines({ tokens, getTokenProps, grammar, foldAll }) {
  const [toggled, setToggled] = useState(new Set());
  const ranges = useMemo(() => { const stack = [], result = new Map(); tokens.forEach((line, i) => line.forEach(token => { if (!token.types.includes('punctuation')) return; for (const char of token.content) { if ('{['.includes(char)) stack.push(i); else if ('}]'.includes(char)) { const start = stack.pop(); if (start !== undefined && i > start + 1) result.set(start, i); } } })); return result; }, [tokens]);
  const folded = [...ranges].filter(([start]) => foldAll !== toggled.has(start));
  return <code className={`language-${grammar}`}>{tokens.map((line, i) => folded.some(([start, end]) => i > start && i < end) ? null : <span className="code-line" key={i}><span className="code-line-number" aria-hidden="true">{i + 1}</span>{ranges.has(i) && <button aria-label={`${folded.some(([start]) => start === i) ? 'Expand' : 'Fold'} block on line ${i + 1}`} aria-expanded={!folded.some(([start]) => start === i)} onClick={() => setToggled(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}>{folded.some(([start]) => start === i) ? '▸' : '▾'}</button>}{line.map((part, j) => { const { key: _key, ...props } = getTokenProps({ token: part }); return <span key={j} {...props} />; })}{folded.some(([start]) => start === i) && <span className="code-fold-count"> … {ranges.get(i) - i - 1} lines</span>}{i < tokens.length - 1 ? '\n' : ''}</span>)}</code>;
}
