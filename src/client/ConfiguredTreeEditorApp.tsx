"use client";

import React, { useEffect, useRef } from "react";
import BaseTreeEditorApp, {
  type TreeEditorAppProps as BaseTreeEditorAppProps,
  type TreeEditorUiConfig as BaseTreeEditorUiConfig,
} from "./TreeEditorApp";

export type TreeEditorFieldUiConfig =
  | string
  | {
      label?: string;
    };

export type TreeEditorUiConfig = BaseTreeEditorUiConfig & {
  // Optional presentation-only mapping by raw JSON field name.
  // A string is shorthand for { label }. If a field is not present here,
  // the editor renders the raw key exactly as it always did.
  // The object form is intentionally extensible so more field-level UI
  // metadata can be added later without changing this API shape.
  fields?: Record<string, TreeEditorFieldUiConfig>;
};

export type TreeEditorAppProps = Omit<BaseTreeEditorAppProps, "uiConfig"> & {
  uiConfig?: TreeEditorUiConfig;
};

function configuredLabel(entry: TreeEditorFieldUiConfig | undefined): string | undefined {
  if (typeof entry === "string") return entry;
  return entry?.label;
}

function splitCountSuffix(raw: string): { key: string; suffix: string } {
  const match = raw.match(/^(.*?)(\s+\(\d+\))$/);
  return match ? { key: match[1].trim(), suffix: match[2] } : { key: raw.trim(), suffix: "" };
}

function labelTextNode(label: HTMLLabelElement): Text | null {
  // Boolean fields render as <label><input ... /> fieldName</label>, while
  // other fields render a plain text label. Work only on the text node so the
  // checkbox/input itself is never replaced.
  for (let i = label.childNodes.length - 1; i >= 0; i -= 1) {
    const node = label.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return node as Text;
  }
  return null;
}

function applyFieldLabels(root: HTMLElement, fields: Record<string, TreeEditorFieldUiConfig> | undefined) {
  root.querySelectorAll<HTMLLabelElement>(".field > label").forEach(label => {
    const textNode = labelTextNode(label);
    if (!textNode) return;

    const currentText = textNode.textContent?.trim() ?? "";
    if (!label.dataset.treeEditorOriginalLabel) {
      label.dataset.treeEditorOriginalLabel = currentText;
    }

    const original = label.dataset.treeEditorOriginalLabel;
    const { key, suffix } = splitCountSuffix(original);
    const replacement = configuredLabel(fields?.[key]);
    const desired = replacement ? `${replacement}${suffix}` : original;
    const prefix = label.querySelector('input[type="checkbox"]') ? " " : "";

    if (textNode.textContent !== `${prefix}${desired}`) {
      textNode.textContent = `${prefix}${desired}`;
    }
  });
}

export default function ConfiguredTreeEditorApp({ uiConfig, ...props }: TreeEditorAppProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fields = uiConfig?.fields;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const apply = () => applyFieldLabels(root, fields);
    apply();

    // Forms change as selection changes and while arrays are edited. Re-apply
    // the presentation mapping to newly rendered labels without touching data.
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [fields]);

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <BaseTreeEditorApp {...props} uiConfig={uiConfig} />
    </div>
  );
}
