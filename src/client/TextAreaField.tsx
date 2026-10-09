"use client";

import React, { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown is rendered to React elements (never inserted as raw HTML).
// GFM adds tables, task lists, strikethrough, and autolinks.
const markdownComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "max-content" }}>{children}</table>
    </div>
  ),
  th: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <th style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: style?.textAlign ?? "start", background: "rgba(128,128,128,.12)" }}>{children}</th>
  ),
  td: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: style?.textAlign ?? "start" }}>{children}</td>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre style={{ overflowX: "auto", whiteSpace: "pre", background: "rgba(128,128,128,.12)", padding: 10, borderRadius: 6 }}>{children}</pre>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote style={{ borderInlineStart: "3px solid #94a3b8", paddingInlineStart: 12, margin: "8px 0", opacity: .9 }}>{children}</blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "underline" }}>{children}</a>
  ),
};

export default function TextAreaField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState(false);
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [height, setHeight] = useState(220);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const normalizedHeight = (number: number) => Math.max(100, Math.min(1600, Math.round(number)));
  const captureResize = () => {
    if (areaRef.current) setHeight(normalizedHeight(areaRef.current.getBoundingClientRect().height));
  };

  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <button type="button" aria-pressed={direction === "rtl"} onClick={() => setDirection(d => d === "ltr" ? "rtl" : "ltr")}>
          {direction === "ltr" ? "RTL" : "LTR"}
        </button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(p => !p)}>
          {preview ? "Edit text" : "Preview MD"}
        </button>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center", marginInlineStart: "auto", fontSize: 12 }}>
          Height
          <input aria-label="Text field height in pixels" type="number" min={100} max={1600} step={20}
            value={height} onChange={e => {
              if (e.target.value !== "") setHeight(normalizedHeight(Number(e.target.value)));
            }}
            style={{ width: 78, padding: "4px 6px", fontSize: 12 }} />
          px
        </label>
      </div>
      {preview ? (
        <div dir={direction} style={{ height, boxSizing: "border-box", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, overflow: "auto" }}>
          {value ? (
            <div style={{ lineHeight: 1.6, overflowWrap: "anywhere" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{value}</ReactMarkdown>
            </div>
          ) : <span style={{ opacity: .6 }}>Nothing to preview</span>}
        </div>
      ) : (
        <textarea ref={areaRef} rows={5} dir={direction} value={value} onChange={e => onChange(e.target.value)}
          onPointerUp={captureResize} onKeyUp={captureResize}
          style={{ display: "block", height, minHeight: 100, maxHeight: 1600, resize: "vertical", width: "100%", boxSizing: "border-box" }} />
      )}
    </div>
  );
}
