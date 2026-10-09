"use client";

import React, { useState } from "react";

// Markdown preview is intentionally rendered as React text/elements, not raw HTML.
// This keeps user-authored JSON strings from being interpreted as executable HTML.
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}

function MarkdownPreview({ value }: { value: string }) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const elements: React.ReactNode[] = [];
  let code: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      if (code === null) code = [];
      else { elements.push(<pre key={i} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "rgba(128,128,128,.10)", padding: 8, borderRadius: 4 }}><code>{code.join("\n")}</code></pre>); code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    if (!line.trim()) { elements.push(<div key={i} style={{ height: 8 }} />); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const size = Math.max(14, 23 - heading[1].length * 2);
      elements.push(<div key={i} role="heading" aria-level={heading[1].length} style={{ fontSize: size, fontWeight: 700, marginTop: 6 }}>{renderInline(heading[2])}</div>);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) { elements.push(<div key={i} style={{ paddingInlineStart: 16 }}>• {renderInline(bullet[1])}</div>); continue; }
    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) { elements.push(<div key={i} style={{ paddingInlineStart: 16 }}>{numbered[1]}. {renderInline(numbered[2])}</div>); continue; }
    elements.push(<div key={i}>{renderInline(line)}</div>);
  }
  if (code !== null) elements.push(<pre key="unfinished-code" style={{ whiteSpace: "pre-wrap" }}><code>{code.join("\n")}</code></pre>);
  return <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6 }}>{elements}</div>;
}

export default function TextAreaField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState(false);
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [height, setHeight] = useState(160);
  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <button type="button" aria-pressed={direction === "rtl"} onClick={() => setDirection(d => d === "ltr" ? "rtl" : "ltr")}>
          {direction === "ltr" ? "RTL" : "LTR"}
        </button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(v => !v)}>
          {preview ? "Edit text" : "Preview MD"}
        </button>
      </div>
      {preview ? (
        <div dir={direction} style={{ minHeight: height, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, overflow: "auto" }}>
          {value ? <MarkdownPreview value={value} /> : <span style={{ opacity: .6 }}>Nothing to preview</span>}
        </div>
      ) : (
        <textarea rows={5} dir={direction} value={value} onChange={e => onChange(e.target.value)}
          onPointerUp={e => setHeight(e.currentTarget.offsetHeight)}
          style={{ minHeight: 100, height, resize: "vertical", width: "100%", boxSizing: "border-box" }} />
      )}
    </div>
  );
}
