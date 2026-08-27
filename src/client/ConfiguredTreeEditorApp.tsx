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

function directFieldLabel(field: HTMLElement): HTMLLabelElement | null {
  return Array.from(field.children).find(
    (child): child is HTMLLabelElement => child instanceof HTMLLabelElement
  ) ?? null;
}

function clearOrdering(parent: HTMLElement) {
  if (parent.dataset.treeEditorOrdered !== "true") return;
  Array.from(parent.children).forEach(child => {
    if (child instanceof HTMLElement) child.style.removeProperty("order");
  });
  parent.style.display = parent.dataset.treeEditorOriginalDisplay ?? "";
  parent.style.flexDirection = parent.dataset.treeEditorOriginalFlexDirection ?? "";
  delete parent.dataset.treeEditorOrdered;
  delete parent.dataset.treeEditorOriginalDisplay;
  delete parent.dataset.treeEditorOriginalFlexDirection;
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

  const parents = new Set<HTMLElement>();
  root.querySelectorAll<HTMLElement>(".field").forEach(field => {
    const label = directFieldLabel(field);
    const parent = field.parentElement;
    if (label?.dataset.treeEditorFieldKey && parent && !field.classList.contains("key-field") && !field.classList.contains("rel-field")) {
      parents.add(parent);
    }
  });

  parents.forEach(parent => {
    const allChildren = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    const candidates = allChildren.filter(child => {
      if (!child.classList.contains("field")) return false;
      if (child.classList.contains("key-field") || child.classList.contains("rel-field")) return false;
      return !!directFieldLabel(child)?.dataset.treeEditorFieldKey;
    });

    if (candidates.length < 2) {
      clearOrdering(parent);
      return;
    }

    const withMeta = candidates.map((field, index) => {
      const key = directFieldLabel(field)?.dataset.treeEditorFieldKey;
      return { field, index, order: key ? configuredOrder(fields?.[key]) : undefined };
    });

    // Strict default: a form level with no explicit orders is left exactly as rendered.
    if (!withMeta.some(item => item.order !== undefined)) {
      clearOrdering(parent);
      return;
    }

    const sorted = [...withMeta].sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order === b.order ? a.index - b.index : a.order - b.order;
      }
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return a.index - b.index;
    });

    // Do not move DOM nodes. Moving them fights React reconciliation and was the
    // cause of the previous render loop. Instead, keep the DOM untouched and use
    // CSS flex order to map the sorted fields onto the same visual slots.
    if (parent.dataset.treeEditorOrdered !== "true") {
      parent.dataset.treeEditorOriginalDisplay = parent.style.display;
      parent.dataset.treeEditorOriginalFlexDirection = parent.style.flexDirection;
      parent.dataset.treeEditorOrdered = "true";
    }
    parent.style.display = "flex";
    parent.style.flexDirection = "column";

    // Preserve every non-field child's original visual position (heading, key
    // field, rel field, metadata, etc.). Only the candidate field slots change.
    allChildren.forEach((child, index) => {
      child.style.order = String(index * 10);
    });
    const candidateSlots = candidates.map(field => allChildren.indexOf(field));
    sorted.forEach((item, index) => {
      item.field.style.order = String(candidateSlots[index] * 10);
    });
  });
}

export default function ConfiguredTreeEditorApp({ uiConfig, ...props }: TreeEditorAppProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fields = uiConfig?.fields;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let scheduled = false;
    const apply = () => {
      scheduled = false;
      applyFieldPresentation(root, fields);
    };
    const scheduleApply = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(apply);
    };

    apply();

    // Observe only structural changes made by React. Label text and CSS style
    // changes made above are deliberately not observed, so presentation changes
    // cannot feed back into the observer and create a render loop.
    const observer = new MutationObserver(scheduleApply);
    observer.observe(root, { childList: true, subtree: true });

    const frame = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fields]);

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <BaseTreeEditorApp {...props} uiConfig={uiConfig} />
    </div>
  );
}
