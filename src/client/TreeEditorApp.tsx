"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | { [k: string]: JsonValue } | JsonValue[];
type Seg = string | number;

type VNode = {
  id: string;
  cap: string;
  badge?: string;
  badgeColor?: string;
  rel?: string;
  relIcon?: string;
  relTitle?: string;
  kind: "obj" | "arr" | "prim";
  children: VNode[];
  path: Seg[];
  expanded: boolean;
};

type DnDProps = {
  isDragging: boolean;
  dropTargetId: string | null;
  isDropInvalid: boolean;
  dropGapTarget: string | null;
  onDragStart: (path: Seg[]) => void;
  onDragOver: (targetPath: Seg[], targetId: string) => void;
  onDragLeave: (id: string) => void;
  onDrop: (targetPath: Seg[]) => void;
  onDragEnd: () => void;
  onGapDragOver: (gapId: string) => void;
  onGapDragLeave: (gapId: string) => void;
  onGapDrop: (parentPath: Seg[], index: number) => void;
};

// ── UI config ("pack") ─────────────────────────────────────────────────────────
//
// Every field here has a default that reproduces the tool's original,
// hardcoded behavior exactly. A host that doesn't pass `uiConfig` at all sees
// zero change. A host brings its own JSON-shaped config as a "pack" and
// overrides only the fields it cares about.

export type TreeEditorRelValue = { value: string; icon: string; label: string };

export type TreeEditorFieldUiConfig =
  | string
  | {
      label?: string;
      order?: number;
    };

export type TreeEditorUiConfig = {
  // Arrays with these keys are "transparent": their items are hoisted directly
  // as children of the parent node instead of showing the array as an intermediate node.
  inlineKeys?: string[];
  // Allowlist of structured field names that may create hierarchy in the tree.
  // Object/array fields left out stay editable in the form but are not tree nodes.
  // At the document wrapper level, objects that contain an allowed field are
  // treated as structural roots; unrelated metadata objects are hidden.
  // Omit to allow every structured field — the original behavior.
  treeKeys?: string[];
  // Priority order of object fields checked for a node's display title.
  captionFields?: string[];
  // Fixed type → badge color map.
  typeColors?: Record<string, string>;
  // Fallback badge color palette, chosen by hashing the type name.
  palette?: string[];
  // Max characters shown for a string value before it's truncated with "…".
  captionTruncateLength?: number;
  // String values longer than this (or containing a newline) render as a textarea.
  longTextThreshold?: number;
  // Hide arrays whose items are all primitives from the tree (shown in the form only).
  showOnlyArraysWithObjects?: boolean;
  // Selectable non-default values for a node's `rel` field, with their tree icon.
  relValues?: TreeEditorRelValue[];
  // Optional presentation-only config by raw JSON field name.
  // A string is shorthand for { label }. `order` controls form presentation only.
  // If no field at a given object level has `order`, Object.entries()/JSON order
  // is preserved exactly. Ordered fields come first; unordered fields retain their
  // original relative order after them.
  fields?: Record<string, TreeEditorFieldUiConfig>;
};

type ResolvedUiConfig = {
  inlineKeys: string[];
  treeKeys?: string[];
  captionFields: string[];
  typeColors: Record<string, string>;
  palette: string[];
  captionTruncateLength: number;
  longTextThreshold: number;
  showOnlyArraysWithObjects: boolean;
  relValues: TreeEditorRelValue[];
  fields?: Record<string, TreeEditorFieldUiConfig>;
};

const DEFAULT_INLINE_KEYS = ["children", "items", "nodes", "elements", "list", "entries"];
const DEFAULT_CAPTION_FIELDS = ["caption", "title", "name", "label", "id"];
const DEFAULT_TYPE_COLORS: Record<string, string> = {
  purpose: "#3b82f6",
  epic: "#8b5cf6",
  story: "#10b981",
  "acceptance-criteria": "#f59e0b",
};
const DEFAULT_PALETTE = ["#6366f1","#8b5cf6","#ec4899","#f43f5e","#f97316","#eab308","#84cc16","#14b8a6","#06b6d4","#3b82f6"];
const DEFAULT_REL_VALUES: TreeEditorRelValue[] = [
  { value: "elaborate", icon: "◆", label: "elaborate (part of parent — inherited by children)" },
];

function resolveUiConfig(cfg?: TreeEditorUiConfig): ResolvedUiConfig {
  return {
    inlineKeys: cfg?.inlineKeys ?? DEFAULT_INLINE_KEYS,
    treeKeys: cfg?.treeKeys,
    captionFields: cfg?.captionFields ?? DEFAULT_CAPTION_FIELDS,
    typeColors: cfg?.typeColors ?? DEFAULT_TYPE_COLORS,
    palette: cfg?.palette ?? DEFAULT_PALETTE,
    captionTruncateLength: cfg?.captionTruncateLength ?? 60,
    longTextThreshold: cfg?.longTextThreshold ?? 80,
    showOnlyArraysWithObjects: cfg?.showOnlyArraysWithObjects ?? true,
    relValues: cfg?.relValues ?? DEFAULT_REL_VALUES,
    fields: cfg?.fields,
  };
}

function isTreeVisible(key: string, cfg: ResolvedUiConfig): boolean {
  return !cfg.treeKeys || cfg.treeKeys.includes(key);
}

function fieldLabel(key: string, cfg: ResolvedUiConfig): string {
  const entry = cfg.fields?.[key];
  if (typeof entry === "string") return entry;
  return entry?.label ?? key;
}

function fieldOrder(key: string, cfg: ResolvedUiConfig): number | undefined {
  const entry = cfg.fields?.[key];
  if (typeof entry === "string" || entry == null) return undefined;
  return typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : undefined;
}

function formEntries(val: Record<string, JsonValue>, cfg: ResolvedUiConfig, skip?: string[]): [string, JsonValue][] {
  const entries = Object.entries(val).filter(([k]) => !skip?.includes(k));
  if (!entries.some(([k]) => fieldOrder(k, cfg) !== undefined)) return entries;

  return entries
    .map((entry, index) => ({ entry, index, order: fieldOrder(entry[0], cfg) }))
    .sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order === b.order ? a.index - b.index : a.order - b.order;
      }
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export type TreeEditorAppProps = {
  // Supplies auth headers for every fetch to /api/treeEditor/*. Host-specific
  // (e.g. pulls a bearer token from that host's own auth/session state).
  // Omit for a local/no-auth tool.
  authHeaders?: () => HeadersInit;
  // Opt-in: shows the "Wireframe" button and calls /api/treeEditor/wireframe.
  // The host must implement that route itself — not part of this package.
  enableWireframe?: boolean;
  // Opt-in: shows the "Backup" button and calls /api/treeEditor/backup.
  // The host must implement that route itself — not part of this package.
  enableBackup?: boolean;
  // Host-supplied JSON "pack" controlling tree/form formatting. Omit for the
  // tool's original behavior.
  uiConfig?: TreeEditorUiConfig;
};

// ── Constants ─────────────────────────────────────────────────────────────────

function typeColor(type: string, cfg: ResolvedUiConfig): string {
  if (type in cfg.typeColors) return cfg.typeColors[type];
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return cfg.palette[h % cfg.palette.length];
}

function badgeLabel(type: string): string {
  if (type.length <= 8) return type.toUpperCase();
  return type.split(/[-_\s]+/).map(w => w[0]?.toUpperCase() ?? "").join("");
}

// ── Path utilities ─────────────────────────────────────────────────────────────

const pathId = (path: Seg[]) => path.map(String).join("\x00");

function getAt(root: JsonValue, path: Seg[]): JsonValue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = root;
  for (const s of path) {
    if (cur == null || typeof cur !== "object") return undefined as unknown as JsonValue;
    cur = cur[s];
  }
  return cur as JsonValue;
}

function setAt(root: JsonValue, path: Seg[], val: JsonValue): JsonValue {
  if (!path.length) return val;
  const [h, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = [...root];
    copy[Number(h)] = rest.length ? setAt(copy[Number(h)], rest, val) : val;
    return copy;
  }
  if (root !== null && typeof root === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy: any = { ...(root as object) };
    copy[String(h)] = rest.length ? setAt(copy[String(h)], rest, val) : val;
    return copy as JsonValue;
  }
  return root;
}

function delAt(root: JsonValue, path: Seg[]): JsonValue {
  if (!path.length) return root;
  const [h, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = [...root];
    if (!rest.length) { copy.splice(Number(h), 1); return copy; }
    copy[Number(h)] = delAt(copy[Number(h)], rest);
    return copy;
  }
  if (root !== null && typeof root === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy: any = { ...(root as object) };
    if (!rest.length) { delete copy[String(h)]; return copy as JsonValue; }
    copy[String(h)] = delAt(copy[String(h)], rest);
    return copy as JsonValue;
  }
  return root;
}

function swapAt(root: JsonValue, path: Seg[], dir: -1 | 1): JsonValue {
  if (!path.length) return root;
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  const parent = getAt(root, parentPath);
  if (Array.isArray(parent)) {
    const i = Number(last), j = i + dir;
    if (j < 0 || j >= parent.length) return root;
    const copy = [...parent];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return parentPath.length ? setAt(root, parentPath, copy) : copy;
  }
  if (parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = parent as any;
    const keys = Object.keys(obj);
    const i = keys.indexOf(String(last)), j = i + dir;
    if (j < 0 || j >= keys.length) return root;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    const reordered: Record<string, JsonValue> = {};
    keys.forEach(k => { reordered[k] = obj[k] as JsonValue; });
    return parentPath.length ? setAt(root, parentPath, reordered) : reordered;
  }
  return root;
}

// ── Virtual tree builder ───────────────────────────────────────────────────────

function nodeCaption(key: string, val: JsonValue, cfg: ResolvedUiConfig): { cap: string; badge?: string } {
  if (val === null) return { cap: `${key}: null` };
  if (typeof val === "string") {
    if (val.length === 0) return { cap: `${key}: ""` };
    const p = val.replace(/\n/g, "↵").slice(0, cfg.captionTruncateLength);
    return { cap: `${key}: "${p}${val.length > cfg.captionTruncateLength ? "…" : ""}"` };
  }
  if (typeof val === "number" || typeof val === "boolean") return { cap: `${key}: ${val}` };
  if (Array.isArray(val)) return { cap: `${key}  [${val.length}]` };

  // Object — prefer semantic title over raw JSON key
  const obj = val as Record<string, JsonValue>;
  let hint: JsonValue | undefined;
  for (const f of cfg.captionFields) {
    if (obj[f] != null) { hint = obj[f]; break; }
  }
  const typeLabel = typeof obj.type === "string" ? obj.type : undefined;

  if (hint != null && typeof hint !== "object" && String(hint).trim() !== "") {
    return { cap: String(hint), badge: typeLabel };
  }

  // Generic fallback: first short single-line string field (skip "type" — it's the badge)
  // Only for indexed array items — named-key nodes use the key itself as the label.
  const isIndexed = /^\d+$/.test(key);
  if (isIndexed) {
    for (const [k, v] of Object.entries(obj)) {
      if (k !== "type" && typeof v === "string" && v.trim() && v.length < 60 && !v.includes("\n")) {
        return { cap: v, badge: typeLabel };
      }
    }
  }

  // No title found — fall back to key-based label
  const keyLabel = isIndexed ? `Item ${Number(key) + 1}` : key;
  return { cap: `${keyLabel}  {${Object.keys(obj).length}}`, badge: typeLabel };
}

function buildNode(val: JsonValue, key: string, path: Seg[], exp: Set<string>, depth: number, cfg: ResolvedUiConfig): VNode {
  const id = pathId(path);
  const kind: VNode["kind"] = Array.isArray(val) ? "arr" : val !== null && typeof val === "object" ? "obj" : "prim";
  const expanded = exp.has(id);
  const { cap, badge } = nodeCaption(key, val, cfg);
  const badgeColor = badge ? typeColor(badge, cfg) : undefined;
  const relVal = kind === "obj" ? (typeof (val as Record<string, JsonValue>).rel === "string" ? (val as Record<string, JsonValue>).rel as string : undefined) : undefined;
  const relEntry = relVal ? cfg.relValues.find(rv => rv.value === relVal) : undefined;

  let children: VNode[] = [];

  if (kind === "obj") {
    const obj = val as Record<string, JsonValue>;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || typeof v !== "object") continue; // primitives → right panel form
      if (!isTreeVisible(k, cfg)) continue; // structured field excluded from hierarchy → form only
      if (Array.isArray(v)) {
        if (cfg.inlineKeys.includes(k)) {
          // Transparent array: hoist its items as direct children of this node
          const hoisted = (v as JsonValue[])
            .map((item, i) => buildNode(item, String(i), [...path, k, i], exp, depth + 1, cfg))
            .filter(c => c.kind !== "prim");
          children.push(...hoisted);
        } else {
          // Only show arrays that contain objects; primitive arrays live in the right panel
          const hasObjects = (v as JsonValue[]).some(x => x !== null && typeof x === "object");
          if (!cfg.showOnlyArraysWithObjects || hasObjects) children.push(buildNode(v, k, [...path, k], exp, depth + 1, cfg));
        }
      } else {
        children.push(buildNode(v, k, [...path, k], exp, depth + 1, cfg));
      }
    }
  } else if (kind === "arr") {
    children = (val as JsonValue[])
      .map((v, i) => buildNode(v, String(i), [...path, i], exp, depth + 1, cfg))
      .filter(c => c.kind !== "prim");
  }

  return { id, cap, badge, badgeColor, rel: relVal, relIcon: relEntry?.icon, relTitle: relEntry?.label, kind, children, path, expanded };
}

function buildForest(doc: JsonValue, exp: Set<string>, cfg: ResolvedUiConfig): VNode[] {
  if (doc == null) return [];
  if (Array.isArray(doc)) return (doc as JsonValue[]).map((v, i) => buildNode(v, String(i), [i], exp, 0, cfg));
  if (typeof doc === "object") {
    const entries = Object.entries(doc as Record<string, JsonValue>);
    if (!cfg.treeKeys) return entries.map(([k, v]) => buildNode(v, k, [k], exp, 0, cfg));

    // A document can wrap the actual hierarchy with metadata (for example
    // { runtime, root }). With a tree allowlist, keep a top-level entry when
    // its own key is structural or when the object it points to owns one of
    // the allowed hierarchy fields. If none match, fall back to the original
    // behavior so a generic single-object document never disappears entirely.
    const structuralRoots = entries.filter(([k, v]) => {
      if (isTreeVisible(k, cfg)) return true;
      if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
      const obj = v as Record<string, JsonValue>;
      return cfg.treeKeys!.some(treeKey => treeKey in obj);
    });
    const visibleEntries = structuralRoots.length > 0 ? structuralRoots : entries;
    return visibleEntries.map(([k, v]) => buildNode(v, k, [k], exp, 0, cfg));
  }
  return [buildNode(doc, "(value)", ["$"], exp, 0, cfg)];
}

function collectIds(nodes: VNode[], maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  return nodes.flatMap(n => [n.id, ...collectIds(n.children, maxDepth, depth + 1)]);
}

// Walks the virtual tree collecting the displayed caption of each node on the
// way down to selPath. Mirrors exactly what the tree shows (semantic captions,
// transparent "children"/"items" keys hidden) instead of raw path segments.
function breadcrumbCaps(forest: VNode[], selPath: Seg[]): string[] {
  const caps: string[] = [];
  let nodes = forest;
  while (true) {
    const match = nodes.find(
      n => n.path.length <= selPath.length && n.path.every((s, i) => String(s) === String(selPath[i]))
    );
    if (!match) break;
    caps.push(match.cap);
    if (match.path.length === selPath.length) break;
    nodes = match.children;
  }
  return caps;
}

// Returns a structural clone of val with all leaf values zeroed.
// Used to pre-populate new child nodes with the same shape as their siblings.
function cloneShape(val: JsonValue): JsonValue {
  if (val === null || typeof val !== "object") {
    if (typeof val === "string") return "";
    if (typeof val === "number") return 0;
    if (typeof val === "boolean") return false;
    return null;
  }
  if (Array.isArray(val)) return [];
  const result: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(val as Record<string, JsonValue>)) {
    result[k] = cloneShape(v);
  }
  return result;
}

// ── Drag-and-drop helpers ──────────────────────────────────────────────────────

function isAncestorPath(possibleAncestor: Seg[], path: Seg[]): boolean {
  if (possibleAncestor.length >= path.length) return false;
  return possibleAncestor.every((seg, i) => String(seg) === String(path[i]));
}

// After deleting the node at deletedPath, decrement any index in targetPath that
// points into the same parent array past the deleted position.
function adjustTargetPath(deletedPath: Seg[], targetPath: Seg[]): Seg[] {
  const parentLen = deletedPath.length - 1;
  const deletedIdx = deletedPath[parentLen];
  if (typeof deletedIdx !== "number" || targetPath.length <= parentLen) return targetPath;
  for (let i = 0; i < parentLen; i++) {
    if (String(targetPath[i]) !== String(deletedPath[i])) return targetPath;
  }
  const targetIdx = Number(targetPath[parentLen]);
  if (!isNaN(targetIdx) && targetIdx > deletedIdx) {
    const result = [...targetPath];
    result[parentLen] = targetIdx - 1;
    return result;
  }
  return targetPath;
}

// Result of a move/reorder: the rewritten document plus the dragged node's new path
// (so the caller can keep it selected/focused).
type MoveResult = { doc: JsonValue; newPath: Seg[] };

// Moves the node at dragPath to be a child (under childrenKey) of the node at targetPath.
// Uses delAt + setAt so the document is never partially written.
function moveNode(doc: JsonValue, dragPath: Seg[], targetPath: Seg[], childrenKey: string): MoveResult | null {
  const draggedNode = getAt(doc, dragPath);
  if (draggedNode === undefined) return null;
  const newDoc = delAt(doc, dragPath);
  const adjustedTarget = adjustTargetPath(dragPath, targetPath);
  const targetNode = getAt(newDoc, adjustedTarget);
  if (targetNode === undefined || typeof targetNode !== "object" || Array.isArray(targetNode)) return null;
  const existing = Array.isArray((targetNode as Record<string, JsonValue>)[childrenKey])
    ? ((targetNode as Record<string, JsonValue>)[childrenKey] as JsonValue[])
    : [];
  const finalDoc = setAt(newDoc, [...adjustedTarget, childrenKey], [...existing, draggedNode]);
  return { doc: finalDoc, newPath: [...adjustedTarget, childrenKey, existing.length] };
}

// Inserts draggedNode at targetIndex in the array at targetParentPath.
// Adjusts index when source and target are in the same array.
function reorderNode(doc: JsonValue, dragPath: Seg[], targetParentPath: Seg[], targetIndex: number): MoveResult | null {
  const draggedNode = getAt(doc, dragPath);
  if (draggedNode === undefined) return null;
  const newDoc = delAt(doc, dragPath);
  // Adjust index: if same array and target is past the deleted position, shift back by 1
  const dragParentPath = dragPath.slice(0, -1);
  const dragIdx = Number(dragPath[dragPath.length - 1]);
  const sameParent = dragParentPath.length === targetParentPath.length &&
    dragParentPath.every((seg, i) => String(seg) === String(targetParentPath[i]));
  const adjustedIndex = sameParent && targetIndex > dragIdx ? targetIndex - 1 : targetIndex;
  const targetArr = getAt(newDoc, targetParentPath);
  if (!Array.isArray(targetArr)) return null;
  const copy = [...(targetArr as JsonValue[])];
  copy.splice(adjustedIndex, 0, draggedNode);
  const finalDoc = setAt(newDoc, targetParentPath, copy);
  return { doc: finalDoc, newPath: [...targetParentPath, adjustedIndex] };
}

// ── Form components ────────────────────────────────────────────────────────────

function PrimField({ label, val, onChange, longTextThreshold = 80 }: { label: string; val: JsonPrimitive; onChange: (v: JsonValue) => void; longTextThreshold?: number }) {
  if (typeof val === "boolean")
    return <div className="field"><label><input type="checkbox" checked={val} onChange={e => onChange(e.target.checked)} /> {label}</label></div>;
  if (typeof val === "number")
    return <div className="field"><label>{label}</label><input type="number" value={val} onChange={e => onChange(Number(e.target.value))} /></div>;
  const s = val == null ? "" : String(val);
  const long = s.length > longTextThreshold || s.includes("\n");
  return (
    <div className="field">
      <label>{label}</label>
      {long ? <textarea rows={5} value={s} onChange={e => onChange(e.target.value)} /> : <input value={s} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

function PrimArrField({ label, items, onChange }: { label: string; items: JsonPrimitive[]; onChange: (v: JsonValue) => void }) {
  const type = items.length > 0 ? typeof items[0] : "string";
  return (
    <div className="field">
      <label>{label}</label>
      {items.map((item, i) => (
        <div key={i} className="arr-row">
          <input
            type={type === "number" ? "number" : "text"}
            value={String(item ?? "")}
            onChange={e => {
              const next = [...items];
              next[i] = type === "number" ? Number(e.target.value) : e.target.value;
              onChange(next);
            }}
          />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="add-btn" onClick={() => onChange([...items, type === "number" ? 0 : ""])}>+ item</button>
    </div>
  );
}

function RelField({ val, cfg, onChange }: { val: Record<string, JsonValue>; cfg: ResolvedUiConfig; onChange: (v: JsonValue) => void }) {
  if (typeof val.type !== "string") return null;
  const rel = typeof val.rel === "string" ? val.rel : "";
  const handleChange = (newRel: string) => {
    if (newRel === "") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rel: _removed, ...rest } = val;
      onChange(rest as JsonValue);
    } else {
      onChange({ ...val, rel: newRel });
    }
  };
  return (
    <div className="field rel-field">
      <label>rel — relationship to parent</label>
      <select value={rel} onChange={e => handleChange(e.target.value)}>
        <option value="">extend (default — inherits from parent)</option>
        {cfg.relValues.map(rv => (
          <option key={rv.value} value={rv.value}>{rv.icon} {rv.label}</option>
        ))}
      </select>
    </div>
  );
}

// Editable list of object items, used in the form for array keys that are
// excluded from the tree (via `treeKeys`) — they still need to be editable.
function ObjArrField({ label, items, cfg, onChange }: { label: string; items: JsonValue[]; cfg: ResolvedUiConfig; onChange: (v: JsonValue) => void }) {
  const upd = (i: number, v: JsonValue) => { const next = [...items]; next[i] = v; onChange(next); };
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, items.length > 0 ? cloneShape(items[0]) : {}]);
  return (
    <div className="field">
      <label>{label} ({items.length})</label>
      {items.map((item, i) => (
        <div key={i} className="nested obj-arr-item">
          <div className="obj-arr-item-header">
            <span>#{i + 1}</span>
            <button type="button" onClick={() => remove(i)}>×</button>
          </div>
          {item !== null && typeof item === "object" && !Array.isArray(item)
            ? <ObjForm val={item as Record<string, JsonValue>} cfg={cfg} onChange={nv => upd(i, nv)} />
            : <PrimField label={`item ${i + 1}`} val={item as JsonPrimitive} onChange={nv => upd(i, nv)} longTextThreshold={cfg.longTextThreshold} />}
        </div>
      ))}
      <button type="button" className="add-btn" onClick={add}>+ {label}</button>
    </div>
  );
}

function ObjForm({ val, cfg, onChange, skip }: { val: Record<string, JsonValue>; cfg: ResolvedUiConfig; onChange: (v: JsonValue) => void; skip?: string[] }) {
  const upd = (k: string, v: JsonValue) => onChange({ ...val, [k]: v });
  const entries = formEntries(val, cfg, skip);
  return (
    <>
      {entries.map(([k, v]) => {
        const label = fieldLabel(k, cfg);
        if (v === null || typeof v !== "object")
          return <PrimField key={k} label={label} val={v as JsonPrimitive} onChange={nv => upd(k, nv)} longTextThreshold={cfg.longTextThreshold} />;
        if (Array.isArray(v) && v.every(x => x === null || typeof x !== "object"))
          return <PrimArrField key={k} label={label} items={v as JsonPrimitive[]} onChange={nv => upd(k, nv)} />;
        if (!Array.isArray(v))
          return (
            <div key={k} className="field">
              <label>{label}</label>
              <div className="nested">
                <ObjForm val={v as Record<string, JsonValue>} cfg={cfg} onChange={nv => upd(k, nv)} />
              </div>
            </div>
          );
        if (!isTreeVisible(k, cfg))
          return <ObjArrField key={k} label={label} items={v as JsonValue[]} cfg={cfg} onChange={nv => upd(k, nv)} />;
        return (
          <div key={k} className="field">
            <label>{label}</label>
            <div className="nested-note">Array [{(v as JsonValue[]).length}] — select in tree to edit items</div>
          </div>
        );
      })}
    </>
  );
}

// ── Drop gap (insertion line between siblings) ────────────────────────────────

function DropGap({ parentPath, index, dnd }: { parentPath: Seg[]; index: number; dnd: DnDProps }) {
  const gapId = pathId(parentPath) + ":" + index;
  const isActive = dnd.dropGapTarget === gapId;
  return (
    <li
      className={"drop-gap" + (dnd.isDragging ? " dragging" : "") + (isActive ? " active" : "")}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); dnd.onGapDragOver(gapId); }}
      onDragLeave={(e) => { e.stopPropagation(); dnd.onGapDragLeave(gapId); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dnd.onGapDrop(parentPath, index); }}
    />
  );
}

// ── Tree row ───────────────────────────────────────────────────────────────────

function VNodeRow({ node, selId, onSel, onToggle, depth, dnd }: {
  node: VNode;
  selId: string | null;
  onSel: (id: string, path: Seg[]) => void;
  onToggle: (id: string) => void;
  depth: number;
  dnd: DnDProps;
}) {
  const sel = selId === node.id;
  const hasKids = node.children.length > 0;
  const kindIcon = node.kind === "obj" ? "{}" : node.kind === "arr" ? "[]" : "·";
  const badgeColor = node.badgeColor ?? null;
  const isDragTarget = dnd.dropTargetId === node.id;
  const canDrag = depth > 0;
  let rowClass = "row" + (sel ? " selected" : "");
  if (isDragTarget) rowClass += dnd.isDropInvalid ? " drop-invalid" : " drop-target";
  return (
    <li>
      <div
        className={rowClass}
        draggable={canDrag}
        onDragStart={canDrag ? (e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          dnd.onDragStart(node.path);
        } : undefined}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); dnd.onDragOver(node.path, node.id); }}
        onDragLeave={(e) => { e.stopPropagation(); dnd.onDragLeave(node.id); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dnd.onDrop(node.path); }}
        onDragEnd={() => dnd.onDragEnd()}
      >
        <span className="toggle" onClick={() => hasKids && onToggle(node.id)}>
          {hasKids ? (node.expanded ? "▾" : "▸") : " "}
        </span>
        {badgeColor
          ? <span className="type-badge" style={{ background: badgeColor }}>{badgeLabel(node.badge!)}</span>
          : <span className="kind-icon">{kindIcon}</span>
        }
        <span className={"cap" + (depth === 0 ? " bold" : "")} onClick={() => onSel(node.id, node.path)}>
          {node.relIcon && <span className="rel-elaborate-icon" title={node.relTitle}>{node.relIcon} </span>}
          {node.cap}
        </span>
      </div>
      {hasKids && node.expanded && (
        <ul className="tree-root children">
          {node.children.map((c, i) => {
            const isArrayItem = typeof c.path[c.path.length - 1] === "number";
            const parentArrPath = isArrayItem ? c.path.slice(0, -1) : null;
            return (
              <React.Fragment key={c.id}>
                {isArrayItem && i === 0 && <DropGap parentPath={parentArrPath!} index={0} dnd={dnd} />}
                <VNodeRow node={c} selId={selId} onSel={onSel} onToggle={onToggle} depth={depth + 1} dnd={dnd} />
                {isArrayItem && <DropGap parentPath={parentArrPath!} index={i + 1} dnd={dnd} />}
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TreeEditorApp({
  authHeaders: authHeadersProp,
  enableWireframe = false,
  enableBackup = false,
  uiConfig,
}: TreeEditorAppProps = {}) {
  const cfg = useMemo(() => resolveUiConfig(uiConfig), [uiConfig]);
  const [doc, setDoc] = useState<JsonValue>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selPath, setSelPath] = useState<Seg[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keyInput, setKeyInput] = useState<string>("");
  const [undoDoc, setUndoDoc] = useState<JsonValue | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropInvalid, setDropInvalid] = useState(false);
  const [dropGapTarget, setDropGapTarget] = useState<string | null>(null);
  const dragPathRef = useRef<Seg[] | null>(null);
  const [showWireframe, setShowWireframe] = useState(false);
  const [wireframeText, setWireframeText] = useState('');
  const [loadingWireframe, setLoadingWireframe] = useState(false);

  const forest = useMemo(() => buildForest(doc, expanded, cfg), [doc, expanded, cfg]);

  const selVal = useMemo(
    () => (selPath && selPath.length > 0 ? getAt(doc, selPath) : doc),
    [doc, selPath]
  );

  const selKind = useMemo((): VNode["kind"] | null => {
    if (selVal === undefined || selVal === null) return null;
    if (Array.isArray(selVal)) return "arr";
    if (typeof selVal === "object") return "obj";
    return "prim";
  }, [selVal]);

  // ── Load project ─────────────────────────────────────────────────────────────

  const authHeaders = useCallback((): HeadersInit => (authHeadersProp ? authHeadersProp() : {}), [authHeadersProp]);

  const loadProject = useCallback(async (name?: string | null) => {
    setLoaded(false);
    setDirty(false);
    try {
      const params = new URLSearchParams();
      if (name) params.set("project", name);
      const res = await fetch(`/api/treeEditor/tree?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json() as { document?: JsonValue; project?: string | null; projects?: string[] };
      const available = (data.projects ?? []).filter((p): p is string => typeof p === "string").sort((a, b) => a.localeCompare(b));
      const active = typeof data.project === "string" ? data.project : name ?? available[0] ?? null;
      setProjects(active ? Array.from(new Set([...available, active])).sort((a, b) => a.localeCompare(b)) : available);
      setProject(active);
      const newDoc = data.document ?? null;
      setDoc(newDoc);
      setSelPath(null);
      setSelId(null);
      // Pre-expand first two levels
      const initForest = buildForest(newDoc, new Set(), cfg);
      setExpanded(new Set(collectIds(initForest, 1)));
    } catch {
      setDoc(null);
    } finally {
      setLoaded(true);
    }
  }, [authHeaders, cfg]);

  useEffect(() => { void loadProject(null); }, [loadProject]);

  // ── Save (on blur / on structural commit — no longer per-keystroke) ───────────

  const docRef = useRef<JsonValue>(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const saveDoc = useCallback((d: JsonValue = docRef.current) => {
    if (!loaded || !project || d == null) return;
    setDirty(false);
    setSaveError(null);
    fetch("/api/treeEditor/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ project, document: d }),
    }).then(async (res) => {
      if (!res.ok) {
        setDirty(true);
        try {
          const body = await res.json() as { errors?: string[]; error?: string };
          setSaveError(body.errors ?? (body.error ? [body.error] : ["Save failed"]));
        } catch {
          setSaveError(["Save failed"]);
        }
      }
    }).catch(() => { setDirty(true); setSaveError(["Save failed — network error"]); });
  }, [loaded, project, authHeaders]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  // Sync keyInput when selection changes to a named-key node
  useEffect(() => {
    if (selPath && selPath.length > 0) {
      const last = selPath[selPath.length - 1];
      if (typeof last === "string") setKeyInput(last);
    }
  }, [selPath]);

  const handleSel = (id: string, path: Seg[]) => { setSelId(id); setSelPath(path); };

  // Selects a node by path and expands all its ancestors so it is visible in the tree.
  const selectAndReveal = useCallback((path: Seg[]) => {
    setSelPath(path);
    setSelId(pathId(path));
    setExpanded(prev => {
      const next = new Set(prev);
      for (let i = 1; i < path.length; i++) next.add(pathId(path.slice(0, i)));
      return next;
    });
  }, []);

  const handleRenameKey = useCallback((newKey: string) => {
    if (!selPath || !selPath.length) return;
    const trimmed = newKey.trim();
    const oldKey = selPath[selPath.length - 1];
    if (typeof oldKey !== "string" || !trimmed || trimmed === oldKey) return;

    const parentPath = selPath.slice(0, -1);
    const parent = parentPath.length ? getAt(doc!, parentPath) : doc;
    if (!parent || Array.isArray(parent) || typeof parent !== "object") return;

    const obj = parent as Record<string, JsonValue>;
    if (trimmed in obj) { alert("Key already exists"); return; }

    // Rebuild object preserving key order, replacing old key with new key
    const rebuilt: Record<string, JsonValue> = {};
    for (const k of Object.keys(obj)) rebuilt[k === oldKey ? trimmed : k] = obj[k];

    const next = parentPath.length ? setAt(doc!, parentPath, rebuilt as JsonValue) : (rebuilt as JsonValue);
    setDoc(next);
    saveDoc(next);
    const newPath = [...parentPath, trimmed];
    setSelPath(newPath);
    setSelId(pathId(newPath));
    setKeyInput(trimmed);
  }, [doc, selPath, saveDoc]);

  const handleToggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDocChange = (next: JsonValue) => { setDirty(true); setDoc(next); };

  const handleValChange = useCallback((path: Seg[], val: JsonValue) => {
    setDirty(true);
    setDoc(prev => setAt(prev!, path, val));
  }, []);

  const addRoot = () => {
    if (doc == null) { const n = {}; handleDocChange(n); saveDoc(n); return; }
    if (Array.isArray(doc)) { const n = [...(doc as JsonValue[]), ""]; handleDocChange(n); saveDoc(n); return; }
    if (typeof doc === "object") {
      const key = window.prompt("New key name:");
      if (!key?.trim()) return;
      const n = { ...(doc as Record<string, JsonValue>), [key.trim()]: "" };
      handleDocChange(n); saveDoc(n);
    }
  };

  const addSub = () => {
    if (!selPath || !selKind) return;
    let next: JsonValue | null = null;
    if (selKind === "arr") {
      const arr = selVal as JsonValue[];
      const template = arr.length > 0 ? cloneShape(arr[0]) : {};
      next = setAt(doc!, selPath, [...arr, template]);
    } else if (selKind === "obj") {
      const obj = selVal as Record<string, JsonValue>;
      // If the node has a visible transparent array (e.g. "children"), add into it automatically
      const inlineKey = cfg.inlineKeys.find(k => isTreeVisible(k, cfg) && k in obj && Array.isArray(obj[k]));
      if (inlineKey) {
        const arr = obj[inlineKey] as JsonValue[];
        const template = arr.length > 0 ? cloneShape(arr[0]) : {};
        next = setAt(doc!, [...selPath, inlineKey], [...arr, template]);
      } else {
        const key = window.prompt("New key name:");
        if (!key?.trim()) return;
        const existingVals = Object.values(obj);
        const template = existingVals.length > 0 ? cloneShape(existingVals[0]) : "";
        next = setAt(doc!, selPath, { ...obj, [key.trim()]: template });
      }
    }
    if (next !== null) { handleDocChange(next); saveDoc(next); }
  };

  const removeNode = () => {
    if (!selPath || !selPath.length) return;
    const next = delAt(doc!, selPath);
    handleDocChange(next);
    saveDoc(next);
    // Select the deleted node's parent so the right pane keeps editing in context,
    // rather than falling back to the whole-document root form.
    let parentPath = selPath.slice(0, -1);
    // If the immediate parent is a transparent (hoisted) array — e.g. "children" —
    // it is not a visible tree row, so step up to the object that owns it.
    const lastSeg = parentPath[parentPath.length - 1];
    if (typeof lastSeg === "string" && cfg.inlineKeys.includes(lastSeg)) {
      parentPath = parentPath.slice(0, -1);
    }
    if (parentPath.length) {
      setSelPath(parentPath);
      setSelId(pathId(parentPath));
    } else {
      setSelPath(null);
      setSelId(null);
    }
  };

  const moveUp = () => { if (selPath?.length) { const n = swapAt(doc!, selPath, -1); handleDocChange(n); saveDoc(n); } };
  const moveDown = () => { if (selPath?.length) { const n = swapAt(doc!, selPath, 1); handleDocChange(n); saveDoc(n); } };

  const expandAll = () => setExpanded(new Set(collectIds(forest, 999)));
  const collapseAll = () => setExpanded(new Set());

  // ── Drag-and-drop handlers ────────────────────────────────────────────────────

  const handleDragStart = useCallback((path: Seg[]) => {
    dragPathRef.current = path;
    setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((targetPath: Seg[], targetId: string) => {
    const dragPath = dragPathRef.current;
    if (!dragPath) return;
    const invalid = pathId(dragPath) === pathId(targetPath) || isAncestorPath(dragPath, targetPath);
    setDropTargetId(targetId);
    setDropInvalid(invalid);
    setDropGapTarget(null);
  }, []);

  const handleDragLeave = useCallback((id: string) => {
    setDropTargetId(prev => prev === id ? null : prev);
  }, []);

  const handleGapDragOver = useCallback((gapId: string) => {
    setDropGapTarget(gapId);
    setDropTargetId(null);
    setDropInvalid(false);
  }, []);

  const handleGapDragLeave = useCallback((gapId: string) => {
    setDropGapTarget(prev => prev === gapId ? null : prev);
  }, []);

  const handleGapDrop = useCallback((parentPath: Seg[], index: number) => {
    const dragPath = dragPathRef.current;
    dragPathRef.current = null;
    setIsDragging(false);
    setDropGapTarget(null);
    setDropTargetId(null);
    setDropInvalid(false);
    if (!dragPath || !doc) return;
    if (isAncestorPath(dragPath, [...parentPath, index])) return;
    const snapshot = doc;
    const result = reorderNode(doc, dragPath, parentPath, index);
    if (!result) return;
    setUndoDoc(snapshot);
    setDoc(result.doc);
    saveDoc(result.doc);
    selectAndReveal(result.newPath);
  }, [doc, selectAndReveal, saveDoc]);

  const handleDrop = useCallback((targetPath: Seg[]) => {
    const dragPath = dragPathRef.current;
    dragPathRef.current = null;
    setIsDragging(false);
    setDropTargetId(null);
    setDropInvalid(false);
    setDropGapTarget(null);
    if (!dragPath || !doc) return;
    if (pathId(dragPath) === pathId(targetPath)) return;
    if (isAncestorPath(dragPath, targetPath)) return;
    const targetNode = getAt(doc, targetPath);
    if (!targetNode || typeof targetNode !== "object" || Array.isArray(targetNode)) return;
    const targetObj = targetNode as Record<string, JsonValue>;
    const inlineKey = cfg.inlineKeys.find(k => isTreeVisible(k, cfg) && k in targetObj && Array.isArray(targetObj[k]));
    let childrenKey: string;
    if (inlineKey) {
      childrenKey = inlineKey;
    } else {
      const ok = window.confirm('Target has no child array. Create a "children" key?');
      if (!ok) return;
      childrenKey = "children";
    }
    const snapshot = doc;
    const result = moveNode(doc, dragPath, targetPath, childrenKey);
    if (!result) return;
    setUndoDoc(snapshot);
    setDoc(result.doc);
    saveDoc(result.doc);
    selectAndReveal(result.newPath);
  }, [doc, selectAndReveal, saveDoc, cfg]);

  const handleDragEnd = useCallback(() => {
    dragPathRef.current = null;
    setIsDragging(false);
    setDropTargetId(null);
    setDropInvalid(false);
    setDropGapTarget(null);
  }, []);

  const handleWireframe = async () => {
    if (!selVal || !selPath) return;
    const parentPath = selPath.slice(0, -1);
    const parentVal = parentPath.length ? getAt(doc!, parentPath) : null;
    const inheritedComponents = Array.isArray(parentVal)
      ? (parentVal as JsonValue[]).filter(
          item => item !== null && typeof item === 'object' && !Array.isArray(item) &&
          (item as Record<string, JsonValue>).rel === 'elaborate'
        )
      : [];
    setShowWireframe(true);
    setWireframeText('');
    setLoadingWireframe(true);
    try {
      const res = await fetch('/api/treeEditor/wireframe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ nodeSubtree: selVal, inheritedComponents, stream: true }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let wireframe = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.chunk) {
                wireframe += data.chunk;
                flushSync(() => { setWireframeText(wireframe); });
              } else if (data.error) {
                setWireframeText(`Error: ${data.error}`);
                return;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }

      if (!wireframe) {
        setWireframeText('No wireframe generated');
      }
    } catch (err) {
      setWireframeText(`Error: ${String(err)}`);
    } finally {
      setLoadingWireframe(false);
    }
  };

  const handleUndo = useCallback(() => {
    if (!undoDoc) return;
    setDoc(undoDoc);
    saveDoc(undoDoc);
    setUndoDoc(null);
    setSelPath(null);
    setSelId(null);
  }, [undoDoc, saveDoc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo]);

  const dnd: DnDProps = useMemo(() => ({
    isDragging,
    dropTargetId,
    isDropInvalid: dropInvalid,
    dropGapTarget,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
    onGapDragOver: handleGapDragOver,
    onGapDragLeave: handleGapDragLeave,
    onGapDrop: handleGapDrop,
  }), [isDragging, dropTargetId, dropInvalid, dropGapTarget, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd, handleGapDragOver, handleGapDragLeave, handleGapDrop]);

  const createProject = async () => {
    const name = window.prompt("New project name:");
    if (!name) return;
    const norm = name.trim().replace(/\.json$/i, "");
    if (!norm || norm.includes("/") || norm.includes("\\") || norm.includes("..")) { alert("Invalid name"); return; }
    if (projects.includes(norm)) { void loadProject(norm); return; }
    await fetch("/api/treeEditor/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ project: norm, document: {} }),
    });
    void loadProject(norm);
  };

  const backup = () => {
    if (!project) return;
    fetch("/api/treeEditor/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ project }),
    }).catch(() => {});
  };

  // ── Right panel ───────────────────────────────────────────────────────────────

  const rightPanel = () => {
    if (!selPath || !selPath.length) {
      // Show root-level object fields when nothing selected
      if (doc !== null && doc !== undefined && typeof doc === "object" && !Array.isArray(doc)) {
        return <ObjForm val={doc as Record<string, JsonValue>} cfg={cfg} onChange={handleDocChange} />;
      }
      return <div className="placeholder">Select a node on the left to edit its fields</div>;
    }

    if (selVal === undefined) return <div className="placeholder">Node not found</div>;

    const isNamedKey = typeof selPath[selPath.length - 1] === "string";
    const keyField = isNamedKey ? (
      <div className="field key-field">
        <label>Key name</label>
        <input
          value={keyInput}
          onChange={e => setKeyInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleRenameKey(keyInput); }}
          onBlur={() => handleRenameKey(keyInput)}
        />
      </div>
    ) : null;

    if (selKind === "obj") {
      const objVal = selVal as Record<string, JsonValue>;
      const hasType = typeof objVal.type === "string";
      return (
        <>
          {enableWireframe && objVal.type === "page" && (
            <button
              onClick={() => { void handleWireframe(); }}
              style={{ marginBottom: 14, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
            >
              ✦ Wireframe
            </button>
          )}
          {keyField}
          <RelField val={objVal} cfg={cfg} onChange={nv => handleValChange(selPath, nv)} />
          <ObjForm
            val={objVal}
            cfg={cfg}
            onChange={nv => handleValChange(selPath, nv)}
            skip={hasType ? ["rel"] : undefined}
          />
        </>
      );
    }

    if (selKind === "arr") {
      const arr = selVal as JsonValue[];
      const primOnly = arr.every(x => x === null || typeof x !== "object");
      if (primOnly) {
        return (
          <>
            {keyField}
            <PrimArrField
              label={`items (${arr.length})`}
              items={arr as JsonPrimitive[]}
              onChange={nv => handleValChange(selPath, nv)}
            />
          </>
        );
      }
      return (
        <>
          {keyField}
          <div className="placeholder">{arr.length} items — select an item in the tree to edit its fields</div>
          <button className="add-btn" style={{ marginTop: 12 }} onClick={addSub}>+ Add item</button>
        </>
      );
    }

    // Primitive
    const key = String(selPath[selPath.length - 1]);
    return (
      <>
        {keyField}
        <PrimField label={fieldLabel(key, cfg)} val={selVal as JsonPrimitive} onChange={nv => handleValChange(selPath, nv)} longTextThreshold={cfg.longTextThreshold} />
      </>
    );
  };

  const breadcrumb = !selPath?.length
    ? "Document root"
    : (() => {
        const caps = breadcrumbCaps(forest, selPath);
        return caps.length ? caps.join(" › ") : selPath.join(" › ");
      })();

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="page" dir="ltr">
      <div className="header">
        <h1>Tree Editor</h1>
        <div className="project-picker">
          <label>
            <span>Project:</span>
            <select
              value={project ?? ""}
              onChange={e => {
                if (e.target.value === "__new__") { void createProject(); return; }
                void loadProject(e.target.value || null);
              }}
            >
              {!project && <option value="">Select a project</option>}
              {projects.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="__new__">New project…</option>
            </select>
          </label>
        </div>
        <button
          className={"save-btn" + (dirty ? " dirty" : "")}
          disabled={!project}
          onClick={() => saveDoc()}
          title={dirty ? "Unsaved changes — click to save" : "No unsaved changes"}
        >
          {dirty ? "● Save" : "Saved"}
        </button>
      </div>

      {saveError && (
        <div className="save-error" role="alert">
          <strong>Save rejected:</strong>
          <ul>{saveError.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div className="content">
        <section className="left">
          <div className="toolbar">
            <button onClick={addRoot}>+ Root</button>
            <button onClick={addSub} disabled={!selId || selKind === "prim"}>+ Child</button>
            <button onClick={moveUp} disabled={!selId}>↑</button>
            <button onClick={moveDown} disabled={!selId}>↓</button>
            <button onClick={removeNode} disabled={!selId}>🗑</button>
            <button onClick={expandAll}>Expand all</button>
            <button onClick={collapseAll}>Collapse all</button>
            {enableBackup && <button onClick={backup} disabled={!project}>Backup</button>}
            <button onClick={handleUndo} disabled={!undoDoc} title="Undo last move (Ctrl+Z)">↩ Undo</button>
          </div>
          <div className="tree">
            {!loaded
              ? <div className="placeholder">Loading…</div>
              : forest.length === 0
              ? <div className="placeholder">Empty — add a root item to start</div>
              : (
                <ul className="tree-root">
                  {forest.map(n => (
                    <VNodeRow
                      key={n.id}
                      node={n}
                      selId={selId}
                      onSel={handleSel}
                      onToggle={handleToggle}
                      depth={0}
                      dnd={dnd}
                    />
                  ))}
                </ul>
              )
            }
          </div>
        </section>

        <section className="right">
          <div className="card" onBlur={() => saveDoc()}>
            <h2>{breadcrumb}</h2>
            {rightPanel()}
            {selPath && selPath.length > 0 && (
              <div className="meta">Path: <code>{JSON.stringify(selPath)}</code></div>
            )}
          </div>
        </section>
      </div>

      {enableWireframe && showWireframe && (
        <div onClick={() => setShowWireframe(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '90vw', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px rgba(0,0,0,0.4)', marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', position: 'sticky', top: 0, background: '#fff', borderRadius: '12px 12px 0 0', zIndex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>✦ Wireframe — {breadcrumb}</h2>
              <button onClick={() => setShowWireframe(false)} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>✕ Close</button>
            </div>
            <div style={{ padding: 24 }}>
              {loadingWireframe && !wireframeText
                ? <div style={{ textAlign: 'center', padding: 60, color: '#64748b', fontSize: 14 }}>Generating wireframe…</div>
                : <pre style={{ fontSize: 12, lineHeight: 1.6, fontFamily: 'monospace', background: '#f8fafc', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', margin: 0, border: '1px solid #e2e8f0', overflowX: 'hidden', maxWidth: '100%', wordBreak: 'break-word' }}>{wireframeText}{loadingWireframe ? '▌' : ''}</pre>
              }
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        * { box-sizing: border-box; }
        .page { min-height: 100vh; background: #f6f7fb; color: #0f172a; padding: 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        .header { max-width: 1200px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
        .project-picker label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
        .project-picker span { font-weight: 600; }
        .project-picker select { min-width: 180px; }
        .save-btn { font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #64748b; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s; }
        .save-btn.dirty { background: #ef4444; color: #fff; border-color: #dc2626; box-shadow: 0 0 0 3px rgba(239,68,68,.25); }
        .save-btn.dirty:hover { background: #dc2626; }
        .save-btn:disabled { opacity: .45; cursor: not-allowed; }
        .save-error { max-width: 1200px; margin: 0 auto 12px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px; padding: 10px 14px; font-size: 13px; }
        .save-error ul { margin: 4px 0 0; padding-left: 18px; }
        .content { max-width: 1200px; margin: 0 auto; display: flex; gap: 16px; align-items: stretch; }
        .left { flex: 0 0 38%; max-width: 38%; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 120px); }
        .right { flex: 1; }
        .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; min-height: 200px; }
        .card h2 { margin: 0 0 14px; font-size: 13px; color: #64748b; font-weight: 600; word-break: break-all; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
        .placeholder { color: #64748b; font-size: 14px; }
        .meta { margin-top: 16px; font-size: 12px; color: #94a3b8; }
        .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .field > label { font-size: 12px; color: #475569; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
        .key-field { border-bottom: 2px solid #e0e7ff; padding-bottom: 14px; margin-bottom: 16px; }
        .key-field > label { color: #6366f1; }
        .nested { margin-left: 12px; padding-left: 12px; border-left: 2px solid #e2e8f0; margin-top: 4px; padding-top: 4px; }
        .obj-arr-item { margin-bottom: 10px; }
        .obj-arr-item-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
        .obj-arr-item-header button { padding: 0 6px; font-size: 12px; line-height: 1.6; }
        .nested-note { font-size: 12px; color: #94a3b8; padding: 6px 10px; background: #f8fafc; border-radius: 6px; border: 1px dashed #e2e8f0; }
        .arr-row { display: flex; gap: 4px; margin-bottom: 4px; }
        .arr-row input { flex: 1; }
        .add-btn { font-size: 12px; color: #6366f1; border: 1px dashed #c7d2fe; background: #eef2ff; border-radius: 6px; padding: 4px 12px; cursor: pointer; margin-top: 4px; }
        .add-btn:hover { background: #e0e7ff; }
        .rel-elaborate-icon { color: #8b5cf6; font-size: 10px; }
        .rel-field { border: 1px solid #e0e7ff; border-radius: 8px; padding: 10px 12px; background: #f5f3ff; margin-bottom: 16px; }
        .rel-field > label { color: #7c3aed !important; }
        input, textarea, select { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 14px; outline: none; width: 100%; font-family: inherit; }
        input:focus, textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
        button { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
        button:hover:not(:disabled) { background: #f8fafc; }
        button:disabled { opacity: .4; cursor: not-allowed; }
        .toolbar { display: flex; align-items: center; gap: 4px; padding: 6px; flex-wrap: wrap; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
        .toolbar button { padding: 4px 8px; font-size: 12px; }
        .tree { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 10px; overflow: auto; flex: 1; min-height: 300px; }
        .tree-root { list-style: none; margin: 0; padding: 0; }
        .row { display: flex; align-items: center; gap: 4px; padding: 5px 4px; border-radius: 6px; cursor: default; }
        .row:hover { background: #f8fafc; }
        .row.selected { background: #eef2ff; outline: 1px solid #c7d2fe; }
        .toggle { width: 16px; text-align: center; font-size: 11px; color: #475569; cursor: pointer; user-select: none; flex-shrink: 0; }
        .kind-icon { font-size: 10px; color: #64748b; font-family: monospace; min-width: 20px; flex-shrink: 0; }
        .type-badge { font-size: 10px; color: #fff; border-radius: 3px; padding: 1px 5px; font-weight: 700; letter-spacing: .4px; flex-shrink: 0; line-height: 1.8; white-space: nowrap; }
        .cap { font-size: 14px; cursor: pointer; line-height: 1.5; color: #020617; }
        .cap.bold { font-weight: 700; }
        .children { margin-left: 18px; padding-left: 6px; border-left: 1px solid #f1f5f9; list-style: none; margin-top: 0; padding-top: 0; }
        .row[draggable="true"] { cursor: grab; }
        .row[draggable="true"]:active { cursor: grabbing; }
        .row.drop-target { background: #dcfce7 !important; outline: 1px solid #86efac; }
        .row.drop-invalid { background: #fee2e2 !important; outline: 1px solid #fca5a5; }
        .drop-gap { list-style: none; height: 2px; border-radius: 3px; margin: 0; transition: height 0.1s, background 0.1s; }
        .drop-gap.dragging { height: 6px; }
        .drop-gap.active { background: #3b82f6; height: 6px; }

        /* ── Dark mode (white on black) ───────────────────────────────────── */
        .dark .page { background: #0a0a0a; color: #f1f5f9; }
        .dark .page .header h1 { color: #f8fafc; }
        .dark .page .project-picker label { color: #cbd5e1; }
        .dark .page .save-btn { background: #1f1f1f; color: #94a3b8; border-color: #444; }
        .dark .page .save-btn.dirty { background: #ef4444; color: #fff; border-color: #dc2626; }
        .dark .page .save-btn.dirty:hover { background: #dc2626; }
        .dark .page .card { background: #161616; border-color: #333; }
        .dark .page .card h2 { color: #94a3b8; border-bottom-color: #262626; }
        .dark .page .placeholder { color: #94a3b8; }
        .dark .page .meta { color: #94a3b8; }
        .dark .page .field > label { color: #cbd5e1; }
        .dark .page .key-field { border-bottom-color: #3730a3; }
        .dark .page .key-field > label { color: #a5b4fc; }
        .dark .page .nested { border-left-color: #333; }
        .dark .page .obj-arr-item-header { color: #64748b; }
        .dark .page .nested-note { background: #1a1a1a; border-color: #333; color: #94a3b8; }
        .dark .page input, .dark .page textarea, .dark .page select { background: #1f1f1f; color: #f1f5f9; border-color: #444; }
        .dark .page input:focus, .dark .page textarea:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.2); }
        .dark .page button { background: #1f1f1f; color: #f1f5f9; border-color: #444; }
        .dark .page button:hover:not(:disabled) { background: #2a2a2a; }
        .dark .page .toolbar { background: #161616; border-color: #333; }
        .dark .page .tree { background: #161616; border-color: #333; }
        .dark .page .row:hover { background: #1f2937; }
        .dark .page .row.selected { background: #1e293b; outline-color: #3b82f6; }
        .dark .page .toggle { color: #94a3b8; }
        .dark .page .kind-icon { color: #94a3b8; }
        .dark .page .cap { color: #f8fafc; }
        .dark .page .children { border-left-color: #262626; }
        .dark .page .add-btn { background: #1e1b4b; border-color: #3730a3; color: #a5b4fc; }
        .dark .page .add-btn:hover { background: #312e81; }
        .dark .page .row.drop-target { background: #14532d !important; outline-color: #22c55e; }
        .dark .page .row.drop-invalid { background: #450a0a !important; outline-color: #ef4444; }
        .dark .page .save-error { background: #450a0a; border-color: #7f1d1d; color: #fca5a5; }
      ` }} />
    </div>
  );
}
