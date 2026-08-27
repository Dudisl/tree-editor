"use client";

import React, { useLayoutEffect, useRef } from "react";
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

function applyFieldLabels(root: HTMLElement, fields: Record<string, TreeEditorFieldUiConfig> | undefined) {
  root.querySelectorAll<HTMLLabelElement>(".field > label").forEach(label => {
    // Boolean fields contain the checkbox inside the label; other labels are
    // plain text. Keep the input intact and replace only the text node.
    const textNodes = Array.from(label.childNodes).filter(
      node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    ) as Text[];
    const textNode = textNodes[textNodes.length - 1];
    if (!textNode) return;

    const current = textNode.textContent?.trim() ?? "";
    if (!label.dataset.treeEditorFieldKey) {
      const { key } = splitCountSuffix(current);
      label.dataset.treeEditorFieldKey = key;
      label.dataset.treeEditorOriginalLabel = current;
    }

    const key = label.dataset.treeEditorFieldKey;
    const original = label.dataset.treeEditorOriginalLabel ?? current;
    if (!key) return;

    const { suffix } = splitCountSuffix(original);
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

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const apply = () => applyFieldLabels(root, fields);

    // Apply synchronously after every mount/update, then keep watching because
    // TreeEditorApp renders the form after async data load and on selection.
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    // Also re-apply on the next paint. This covers React hydration/reconciliation
    // replacing a label after the observer was attached.
    const frame = requestAnimationFrame(apply);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fields]);

  return (
    <div
      ref={rootRef}
      data-tree-editor-fields={fields ? "enabled" : "disabled"}
      style={{ display: "contents" }}
    >
      <BaseTreeEditorApp {...props} uiConfig={uiConfig} />
    </div>
  );
}
