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
      order?: number;
    };

export type TreeEditorUiConfig = BaseTreeEditorUiConfig & {
  // Optional presentation-only mapping by raw JSON field name.
  // A string is shorthand for { label }. If a field is not present here,
  // the editor renders the raw key exactly as it always did.
  // `order` is optional. If no field has an order, original JSON field order
  // is preserved exactly. When orders are supplied, ordered fields are shown
  // first by ascending order; unordered fields follow in their original order.
  // The object form remains extensible for future field-level UI metadata.
  fields?: Record<string, TreeEditorFieldUiConfig>;
};

export type TreeEditorAppProps = Omit<BaseTreeEditorAppProps, "uiConfig"> & {
  uiConfig?: TreeEditorUiConfig;
};

function configuredLabel(entry: TreeEditorFieldUiConfig | undefined): string | undefined {
  if (typeof entry === "string") return entry;
  return entry?.label;
}

function configuredOrder(entry: TreeEditorFieldUiConfig | undefined): number | undefined {
  if (typeof entry === "string" || entry == null) return undefined;
  return typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : undefined;
}

function splitCountSuffix(raw: string): { key: string; suffix: string } {
  const match = raw.match(/^(.*?)(\s+\(\d+\))$/);
  return match ? { key: match[1].trim(), suffix: match[2] } : { key: raw.trim(), suffix: "" };
}

function applyFieldPresentation(root: HTMLElement, fields: Record<string, TreeEditorFieldUiConfig> | undefined) {
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

  // Reorder only when at least one configured field explicitly has `order`.
  // This makes omission of `order` a strict no-op and preserves today's
  // Object.entries()/JSON order as the default behavior.
  const hasConfiguredOrder = fields && Object.values(fields).some(entry => configuredOrder(entry) !== undefined);
  if (!hasConfiguredOrder) return;

  const parents = new Set<HTMLElement>();
  root.querySelectorAll<HTMLLabelElement>(".field > label[data-tree-editor-field-key]").forEach(label => {
    const field = label.parentElement;
    const parent = field?.parentElement;
    if (field && parent && !field.classList.contains("key-field") && !field.classList.contains("rel-field")) {
      parents.add(parent);
    }
  });

  parents.forEach(parent => {
    const candidates = Array.from(parent.children).filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement) || !child.classList.contains("field")) return false;
      if (child.classList.contains("key-field") || child.classList.contains("rel-field")) return false;
      return !!child.querySelector(":scope > label[data-tree-editor-field-key]");
    });
    if (candidates.length < 2) return;

    const withMeta = candidates.map((field, index) => {
      const label = field.querySelector<HTMLLabelElement>(":scope > label[data-tree-editor-field-key]");
      const key = label?.dataset.treeEditorFieldKey;
      return { field, index, order: key ? configuredOrder(fields?.[key]) : undefined };
    });

    // If this particular form level has no ordered fields, leave it untouched.
    if (!withMeta.some(item => item.order !== undefined)) return;

    const sorted = [...withMeta].sort((a, b) => {
      const ao = a.order;
      const bo = b.order;
      if (ao !== undefined && bo !== undefined) return ao === bo ? a.index - b.index : ao - bo;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a.index - b.index;
    });

    const alreadySorted = sorted.every((item, index) => item.field === candidates[index]);
    if (alreadySorted) return;

    const anchor = candidates[0];
    sorted.forEach(item => parent.insertBefore(item.field, anchor));
  });
}

export default function ConfiguredTreeEditorApp({ uiConfig, ...props }: TreeEditorAppProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fields = uiConfig?.fields;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let applying = false;
    const apply = () => {
      if (applying) return;
      applying = true;
      try {
        applyFieldPresentation(root, fields);
      } finally {
        applying = false;
      }
    };

    // Apply synchronously after every mount/update, then keep watching because
    // TreeEditorApp renders the form after async data load and on selection.
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    // Also re-apply on the next paint. This covers React hydration/reconciliation
    // replacing a field after the observer was attached.
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
