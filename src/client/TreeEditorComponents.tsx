"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type {
  TreeEditorAppProps as BaseTreeEditorAppProps,
  TreeEditorContext as PublicTreeEditorContext,
  TreeEditorFieldUiConfig,
  TreeEditorRelValue,
  TreeEditorUiConfig,
} from "./TreeEditorApp";

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
const DEFAULT_PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#84cc16", "#14b8a6", "#06b6d4", "#3b82f6",
];
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

function formEntries(
  val: Record<string, JsonValue>,
  cfg: ResolvedUiConfig,
  skip?: string[],
): [string, JsonValue][] {
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
    if (!rest.length) {
      copy.splice(Number(h), 1);
      return copy;
    }
    copy[Number(h)] = delAt(copy[Number(h)], rest);
    return copy;
  }
  if (root !== null && typeof root === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy: any = { ...(root as object) };
    if (!rest.length) {
      delete copy[String(h)];
      return copy as JsonValue;
    }
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
    const i = Number(last);
    const j = i + dir;
    if (j < 0 || j >= parent.length) return root;
    const copy = [...parent];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return parentPath.length ? setAt(root, parentPath, copy) : copy;
  }
  if (parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
    const obj = parent as Record<string, JsonValue>;
    const keys = Object.keys(obj);
    const i = keys.indexOf(String(last));
    const j = i + dir;
    if (j < 0 || j >= keys.length) return root;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    const reordered: Record<string, JsonValue> = {};
    keys.forEach(k => { reordered[k] = obj[k]; });
    return parentPath.length ? setAt(root, parentPath, reordered) : reordered;
  }
  return root;
}

function nodeCaption(
  key: string,
  val: JsonValue,
  cfg: ResolvedUiConfig,
): { cap: string; badge?: string } {
  if (val === null) return { cap: `${key}: null` };
  if (typeof val === "string") {
    if (val.length === 0) return { cap: `${key}: ""` };
    const p = val.replace(/\n/g, "↵").slice(0, cfg.captionTruncateLength);
    return { cap: `${key}: "${p}${val.length > cfg.captionTruncateLength ? "…" : ""}"` };
  }
  if (typeof val === "number" || typeof val === "boolean") return { cap: `${key}: ${val}` };
  if (Array.isArray(val)) return { cap: `${key}  [${val.length}]` };

  const obj = val as Record<string, JsonValue>;
  let hint: JsonValue | undefined;
  for (const f of cfg.captionFields) {
    if (obj[f] != null) {
      hint = obj[f];
      break;
    }
  }
  const typeLabel = typeof obj.type === "string" ? obj.type : undefined;
  if (hint != null && typeof hint !== "object" && String(hint).trim() !== "") {
    return { cap: String(hint), badge: typeLabel };
  }

  const isIndexed = /^\d+$/.test(key);
  if (isIndexed) {
    for (const [k, v] of Object.entries(obj)) {
      if (k !== "type" && typeof v === "string" && v.trim() && v.length < 60 && !v.includes("\n")) {
        return { cap: v, badge: typeLabel };
      }
    }
  }

  const keyLabel = isIndexed ? `Item ${Number(key) + 1}` : key;
  return { cap: `${keyLabel}  {${Object.keys(obj).length}}`, badge: typeLabel };
}

function buildNode(
  val: JsonValue,
  key: string,
  path: Seg[],
  exp: Set<string>,
  cfg: ResolvedUiConfig,
): VNode {
  const id = pathId(path);
  const kind: VNode["kind"] = Array.isArray(val)
    ? "arr"
    : val !== null && typeof val === "object"
      ? "obj"
      : "prim";
  const expanded = exp.has(id);
  const { cap, badge } = nodeCaption(key, val, cfg);
  const badgeColor = badge ? typeColor(badge, cfg) : undefined;
  const relVal = kind === "obj" && typeof (val as Record<string, JsonValue>).rel === "string"
    ? String((val as Record<string, JsonValue>).rel)
    : undefined;
  const relEntry = relVal ? cfg.relValues.find(rv => rv.value === relVal) : undefined;

  let children: VNode[] = [];
  if (kind === "obj") {
    const obj = val as Record<string, JsonValue>;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || typeof v !== "object") continue;
      if (!isTreeVisible(k, cfg)) continue;
      if (Array.isArray(v)) {
        if (cfg.inlineKeys.includes(k)) {
          children.push(
            ...(v as JsonValue[])
              .map((item, i) => buildNode(item, String(i), [...path, k, i], exp, cfg))
              .filter(c => c.kind !== "prim"),
          );
        } else {
          const hasObjects = (v as JsonValue[]).some(x => x !== null && typeof x === "object");
          if (!cfg.showOnlyArraysWithObjects || hasObjects) {
            children.push(buildNode(v, k, [...path, k], exp, cfg));
          }
        }
      } else {
        children.push(buildNode(v, k, [...path, k], exp, cfg));
      }
    }
  } else if (kind === "arr") {
    children = (val as JsonValue[])
      .map((v, i) => buildNode(v, String(i), [...path, i], exp, cfg))
      .filter(c => c.kind !== "prim");
  }

  return {
    id,
    cap,
    badge,
    badgeColor,
    rel: relVal,
    relIcon: relEntry?.icon,
    relTitle: relEntry?.label,
    kind,
    children,
    path,
    expanded,
  };
}

function buildForest(doc: JsonValue, exp: Set<string>, cfg: ResolvedUiConfig): VNode[] {
  if (doc == null) return [];
  if (Array.isArray(doc)) return doc.map((v, i) => buildNode(v, String(i), [i], exp, cfg));
  if (typeof doc === "object") {
    const entries = Object.entries(doc as Record<string, JsonValue>);
    if (!cfg.treeKeys) return entries.map(([k, v]) => buildNode(v, k, [k], exp, cfg));

    const structuralRoots = entries.filter(([k, v]) => {
      if (isTreeVisible(k, cfg)) return true;
      if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
      const obj = v as Record<string, JsonValue>;
      return cfg.treeKeys!.some(treeKey => treeKey in obj);
    });
    const visibleEntries = structuralRoots.length > 0 ? structuralRoots : entries;
    return visibleEntries.map(([k, v]) => buildNode(v, k, [k], exp, cfg));
  }
  return [buildNode(doc, "(value)", ["$"], exp, cfg)];
}

function collectIds(nodes: VNode[], maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  return nodes.flatMap(n => [n.id, ...collectIds(n.children, maxDepth, depth + 1)]);
}

function breadcrumbCaps(forest: VNode[], selPath: Seg[]): string[] {
  const caps: string[] = [];
  let nodes = forest;
  while (true) {
    const match = nodes.find(
      n => n.path.length <= selPath.length && n.path.every((s, i) => String(s) === String(selPath[i])),
    );
    if (!match) break;
    caps.push(match.cap);
    if (match.path.length === selPath.length) break;
    nodes = match.children;
  }
  return caps;
}

function cloneShape(val: JsonValue): JsonValue {
  if (val === null || typeof val !== "object") {
    if (typeof val === "string") return "";
    if (typeof val === "number") return 0;
    if (typeof val === "boolean") return false;
    return null;
  }
  if (Array.isArray(val)) return [];
  const result: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(val)) result[k] = cloneShape(v);
  return result;
}

function isAncestorPath(possibleAncestor: Seg[], path: Seg[]): boolean {
  if (possibleAncestor.length >= path.length) return false;
  return possibleAncestor.every((seg, i) => String(seg) === String(path[i]));
}

function adjustTargetPath(deletedPath: Seg[], targetPath: Seg[]): Seg[] {
  const parentLen = deletedPath.length - 1;
  const deletedIdx = deletedPath[parentLen];
  if (typeof deletedIdx !== "number" || targetPath.length <= parentLen) return targetPath;
  for (let i = 0; i < parentLen; i++) {
    if (String(targetPath[i]) !== String(deletedPath[i])) return targetPath;
  }
  const targetIdx = Number(targetPath[parentLen]);
  if (!Number.isNaN(targetIdx) && targetIdx > deletedIdx) {
    const result = [...targetPath];
    result[parentLen] = targetIdx - 1;
    return result;
  }
  return targetPath;
}

type MoveResult = { doc: JsonValue; newPath: Seg[] };

function moveNode(
  doc: JsonValue,
  dragPath: Seg[],
  targetPath: Seg[],
  childrenKey: string,
): MoveResult | null {
  const draggedNode = getAt(doc, dragPath);
  if (draggedNode === undefined) return null;
  const newDoc = delAt(doc, dragPath);
  const adjustedTarget = adjustTargetPath(dragPath, targetPath);
  const targetNode = getAt(newDoc, adjustedTarget);
  if (targetNode === undefined || typeof targetNode !== "object" || Array.isArray(targetNode)) return null;
  const existing = Array.isArray((targetNode as Record<string, JsonValue>)[childrenKey])
    ? (targetNode as Record<string, JsonValue>)[childrenKey] as JsonValue[]
    : [];
  const finalDoc = setAt(newDoc, [...adjustedTarget, childrenKey], [...existing, draggedNode]);
  return { doc: finalDoc, newPath: [...adjustedTarget, childrenKey, existing.length] };
}

function reorderNode(
  doc: JsonValue,
  dragPath: Seg[],
  targetParentPath: Seg[],
  targetIndex: number,
): MoveResult | null {
  const draggedNode = getAt(doc, dragPath);
  if (draggedNode === undefined) return null;
  const newDoc = delAt(doc, dragPath);
  const dragParentPath = dragPath.slice(0, -1);
  const dragIdx = Number(dragPath[dragPath.length - 1]);
  const sameParent = dragParentPath.length === targetParentPath.length
    && dragParentPath.every((seg, i) => String(seg) === String(targetParentPath[i]));
  const adjustedIndex = sameParent && targetIndex > dragIdx ? targetIndex - 1 : targetIndex;
  const targetArr = getAt(newDoc, targetParentPath);
  if (!Array.isArray(targetArr)) return null;
  const copy = [...targetArr];
  copy.splice(adjustedIndex, 0, draggedNode);
  const finalDoc = setAt(newDoc, targetParentPath, copy);
  return { doc: finalDoc, newPath: [...targetParentPath, adjustedIndex] };
}

function PrimField({
  label,
  val,
  onChange,
  longTextThreshold = 80,
}: {
  label: string;
  val: JsonPrimitive;
  onChange: (v: JsonValue) => void;
  longTextThreshold?: number;
}) {
  if (typeof val === "boolean") {
    return (
      <div className="field">
        <label><input type="checkbox" checked={val} onChange={e => onChange(e.target.checked)} /> {label}</label>
      </div>
    );
  }
  if (typeof val === "number") {
    return (
      <div className="field">
        <label>{label}</label>
        <input type="number" value={val} onChange={e => onChange(Number(e.target.value))} />
      </div>
    );
  }
  const s = val == null ? "" : String(val);
  const long = s.length > longTextThreshold || s.includes("\n");
  return (
    <div className="field">
      <label>{label}</label>
      {long
        ? <textarea rows={5} value={s} onChange={e => onChange(e.target.value)} />
        : <input value={s} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

function PrimArrField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: JsonPrimitive[];
  onChange: (v: JsonValue) => void;
}) {
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
      <button
        type="button"
        className="add-btn"
        onClick={() => onChange([...items, type === "number" ? 0 : ""])}
      >
        + item
      </button>
    </div>
  );
}

function RelField({
  val,
  cfg,
  onChange,
}: {
  val: Record<string, JsonValue>;
  cfg: ResolvedUiConfig;
  onChange: (v: JsonValue) => void;
}) {
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

function ObjArrField({
  label,
  items,
  cfg,
  onChange,
}: {
  label: string;
  items: JsonValue[];
  cfg: ResolvedUiConfig;
  onChange: (v: JsonValue) => void;
}) {
  const upd = (i: number, v: JsonValue) => {
    const next = [...items];
    next[i] = v;
    onChange(next);
  };
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

function ObjForm({
  val,
  cfg,
  onChange,
  skip,
}: {
  val: Record<string, JsonValue>;
  cfg: ResolvedUiConfig;
  onChange: (v: JsonValue) => void;
  skip?: string[];
}) {
  const upd = (k: string, v: JsonValue) => onChange({ ...val, [k]: v });
  const entries = formEntries(val, cfg, skip);
  return (
    <>
      {entries.map(([k, v]) => {
        const label = fieldLabel(k, cfg);
        if (v === null || typeof v !== "object") {
          return <PrimField key={k} label={label} val={v as JsonPrimitive} onChange={nv => upd(k, nv)} longTextThreshold={cfg.longTextThreshold} />;
        }
        if (Array.isArray(v) && v.every(x => x === null || typeof x !== "object")) {
          return <PrimArrField key={k} label={label} items={v as JsonPrimitive[]} onChange={nv => upd(k, nv)} />;
        }
        if (!Array.isArray(v)) {
          return (
            <div key={k} className="field">
              <label>{label}</label>
              <div className="nested">
                <ObjForm val={v as Record<string, JsonValue>} cfg={cfg} onChange={nv => upd(k, nv)} />
              </div>
            </div>
          );
        }
        if (!isTreeVisible(k, cfg)) {
          return <ObjArrField key={k} label={label} items={v} cfg={cfg} onChange={nv => upd(k, nv)} />;
        }
        return (
          <div key={k} className="field">
            <label>{label}</label>
            <div className="nested-note">Array [{v.length}] — select in tree to edit items</div>
          </div>
        );
      })}
    </>
  );
}

function DropGap({ parentPath, index, dnd }: { parentPath: Seg[]; index: number; dnd: DnDProps }) {
  const gapId = `${pathId(parentPath)}:${index}`;
  const isActive = dnd.dropGapTarget === gapId;
  return (
    <li
      className={`drop-gap${dnd.isDragging ? " dragging" : ""}${isActive ? " active" : ""}`}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); dnd.onGapDragOver(gapId); }}
      onDragLeave={e => { e.stopPropagation(); dnd.onGapDragLeave(gapId); }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); dnd.onGapDrop(parentPath, index); }}
    />
  );
}

function VNodeRow({
  node,
  selId,
  onSel,
  onToggle,
  depth,
  dnd,
  editable,
}: {
  node: VNode;
  selId: string | null;
  onSel: (id: string, path: Seg[]) => void;
  onToggle: (id: string) => void;
  depth: number;
  dnd: DnDProps;
  editable: boolean;
}) {
  const sel = selId === node.id;
  const hasKids = node.children.length > 0;
  const kindIcon = node.kind === "obj" ? "{}" : node.kind === "arr" ? "[]" : "·";
  const badgeColor = node.badgeColor ?? null;
  const isDragTarget = editable && dnd.dropTargetId === node.id;
  const canDrag = editable && depth > 0;
  let rowClass = `row${sel ? " selected" : ""}`;
  if (isDragTarget) rowClass += dnd.isDropInvalid ? " drop-invalid" : " drop-target";

  return (
    <li>
      <div
        className={rowClass}
        draggable={canDrag}
        onDragStart={canDrag ? e => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          dnd.onDragStart(node.path);
        } : undefined}
        onDragOver={editable ? e => { e.preventDefault(); e.stopPropagation(); dnd.onDragOver(node.path, node.id); } : undefined}
        onDragLeave={editable ? e => { e.stopPropagation(); dnd.onDragLeave(node.id); } : undefined}
        onDrop={editable ? e => { e.preventDefault(); e.stopPropagation(); dnd.onDrop(node.path); } : undefined}
        onDragEnd={editable ? () => dnd.onDragEnd() : undefined}
      >
        <span className="toggle" onClick={() => hasKids && onToggle(node.id)}>
          {hasKids ? (node.expanded ? "▾" : "▸") : " "}
        </span>
        {badgeColor
          ? <span className="type-badge" style={{ background: badgeColor }}>{badgeLabel(node.badge!)}</span>
          : <span className="kind-icon">{kindIcon}</span>}
        <span className={`cap${depth === 0 ? " bold" : ""}`} onClick={() => onSel(node.id, node.path)}>
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
                {editable && isArrayItem && i === 0 && <DropGap parentPath={parentArrPath!} index={0} dnd={dnd} />}
                <VNodeRow
                  node={c}
                  selId={selId}
                  onSel={onSel}
                  onToggle={onToggle}
                  depth={depth + 1}
                  dnd={dnd}
                  editable={editable}
                />
                {editable && isArrayItem && <DropGap parentPath={parentArrPath!} index={i + 1} dnd={dnd} />}
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export type TreeEditorProviderProps = BaseTreeEditorAppProps & {
  children: React.ReactNode;
};

export type TreeEditorTreeProps = {
  showToolbar?: boolean;
};

export type ComposableTreeEditorAppProps = BaseTreeEditorAppProps & {
  showHeader?: boolean;
  showToolbar?: boolean;
};

type StateValue = {
  cfg: ResolvedUiConfig;
  doc: JsonValue;
  forest: VNode[];
  selPath: Seg[] | null;
  selId: string | null;
  selVal: JsonValue;
  selKind: VNode["kind"] | null;
  projects: string[];
  project: string | null;
  loaded: boolean;
  keyInput: string;
  setKeyInput: React.Dispatch<React.SetStateAction<string>>;
  undoDoc: JsonValue | null;
  dirty: boolean;
  saveError: string[] | null;
  enableWireframe: boolean;
  enableBackup: boolean;
  showWireframe: boolean;
  setShowWireframe: React.Dispatch<React.SetStateAction<boolean>>;
  wireframeText: string;
  loadingWireframe: boolean;
  dnd: DnDProps;
  handleSel: (id: string, path: Seg[]) => void;
  handleToggle: (id: string) => void;
  handleDocChange: (next: JsonValue) => void;
  handleValChange: (path: Seg[], val: JsonValue) => void;
  handleRenameKey: (newKey: string) => void;
  addRoot: () => void;
  addSub: () => void;
  removeNode: () => void;
  moveUp: () => void;
  moveDown: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  handleUndo: () => void;
  handleWireframe: () => Promise<void>;
  saveDoc: (d?: JsonValue) => void;
  loadProject: (name?: string | null) => Promise<void>;
  createProject: () => Promise<void>;
  backup: () => void;
  breadcrumb: string;
};

const TreeEditorStateContext = createContext<StateValue | null>(null);

function useTreeEditorState(): StateValue {
  const ctx = useContext(TreeEditorStateContext);
  if (!ctx) throw new Error("TreeEditor components must be rendered inside <TreeEditorProvider>.");
  return ctx;
}

export function TreeEditorProvider({
  authHeaders: authHeadersProp,
  enableWireframe = false,
  enableBackup = false,
  uiConfig,
  onContextChange,
  children,
}: TreeEditorProviderProps) {
  const cfg = useMemo(() => resolveUiConfig(uiConfig), [uiConfig]);
  const [doc, setDoc] = useState<JsonValue>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selPath, setSelPath] = useState<Seg[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [undoDoc, setUndoDoc] = useState<JsonValue | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropInvalid, setDropInvalid] = useState(false);
  const [dropGapTarget, setDropGapTarget] = useState<string | null>(null);
  const dragPathRef = useRef<Seg[] | null>(null);
  const [showWireframe, setShowWireframe] = useState(false);
  const [wireframeText, setWireframeText] = useState("");
  const [loadingWireframe, setLoadingWireframe] = useState(false);

  const forest = useMemo(() => buildForest(doc, expanded, cfg), [doc, expanded, cfg]);
  const selVal = useMemo(
    () => (selPath && selPath.length > 0 ? getAt(doc, selPath) : doc),
    [doc, selPath],
  );
  const selKind = useMemo((): VNode["kind"] | null => {
    if (selVal === undefined || selVal === null) return null;
    if (Array.isArray(selVal)) return "arr";
    if (typeof selVal === "object") return "obj";
    return "prim";
  }, [selVal]);

  useEffect(() => {
    const selectedNodeId = selVal !== null
      && typeof selVal === "object"
      && !Array.isArray(selVal)
      && typeof (selVal as Record<string, JsonValue>).id === "string"
      ? String((selVal as Record<string, JsonValue>).id)
      : null;
    const context: PublicTreeEditorContext = {
      project,
      document: doc,
      selectedPath: selPath ? [...selPath] : null,
      selectedNodeId,
    };
    onContextChange?.(context);
  }, [doc, project, selPath, selVal, onContextChange]);

  const authHeaders = useCallback(
    (): HeadersInit => (authHeadersProp ? authHeadersProp() : {}),
    [authHeadersProp],
  );

  const loadProject = useCallback(async (name?: string | null) => {
    setLoaded(false);
    setDirty(false);
    try {
      const params = new URLSearchParams();
      if (name) params.set("project", name);
      const res = await fetch(`/api/treeEditor/tree?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json() as {
        document?: JsonValue;
        project?: string | null;
        projects?: string[];
      };
      const available = (data.projects ?? [])
        .filter((p): p is string => typeof p === "string")
        .sort((a, b) => a.localeCompare(b));
      const active = typeof data.project === "string" ? data.project : name ?? available[0] ?? null;
      setProjects(active
        ? Array.from(new Set([...available, active])).sort((a, b) => a.localeCompare(b))
        : available);
      setProject(active);
      const newDoc = data.document ?? null;
      setDoc(newDoc);
      setSelPath(null);
      setSelId(null);
      const initForest = buildForest(newDoc, new Set(), cfg);
      setExpanded(new Set(collectIds(initForest, 1)));
    } catch {
      setDoc(null);
    } finally {
      setLoaded(true);
    }
  }, [authHeaders, cfg]);

  useEffect(() => { void loadProject(null); }, [loadProject]);

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
    }).then(async res => {
      if (!res.ok) {
        setDirty(true);
        try {
          const body = await res.json() as { errors?: string[]; error?: string };
          setSaveError(body.errors ?? (body.error ? [body.error] : ["Save failed"]));
        } catch {
          setSaveError(["Save failed"]);
        }
      }
    }).catch(() => {
      setDirty(true);
      setSaveError(["Save failed — network error"]);
    });
  }, [loaded, project, authHeaders]);

  useEffect(() => {
    if (selPath && selPath.length > 0) {
      const last = selPath[selPath.length - 1];
      if (typeof last === "string") setKeyInput(last);
    }
  }, [selPath]);

  const handleSel = (id: string, path: Seg[]) => {
    setSelId(id);
    setSelPath(path);
  };

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
    const parent = parentPath.length ? getAt(doc, parentPath) : doc;
    if (!parent || Array.isArray(parent) || typeof parent !== "object") return;
    const obj = parent as Record<string, JsonValue>;
    if (trimmed in obj) {
      alert("Key already exists");
      return;
    }

    const rebuilt: Record<string, JsonValue> = {};
    for (const k of Object.keys(obj)) rebuilt[k === oldKey ? trimmed : k] = obj[k];
    const next = parentPath.length ? setAt(doc, parentPath, rebuilt) : rebuilt;
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

  const handleDocChange = (next: JsonValue) => {
    setDirty(true);
    setDoc(next);
  };

  const handleValChange = useCallback((path: Seg[], val: JsonValue) => {
    setDirty(true);
    setDoc(prev => setAt(prev, path, val));
  }, []);

  const addRoot = () => {
    if (doc == null) {
      const n: JsonValue = {};
      handleDocChange(n);
      saveDoc(n);
      return;
    }
    if (Array.isArray(doc)) {
      const n: JsonValue = [...doc, ""];
      handleDocChange(n);
      saveDoc(n);
      return;
    }
    if (typeof doc === "object") {
      const key = window.prompt("New key name:");
      if (!key?.trim()) return;
      const n: JsonValue = { ...doc, [key.trim()]: "" };
      handleDocChange(n);
      saveDoc(n);
    }
  };

  const addSub = () => {
    if (!selPath || !selKind) return;
    let next: JsonValue | null = null;
    if (selKind === "arr") {
      const arr = selVal as JsonValue[];
      const template = arr.length > 0 ? cloneShape(arr[0]) : {};
      next = setAt(doc, selPath, [...arr, template]);
    } else if (selKind === "obj") {
      const obj = selVal as Record<string, JsonValue>;
      const inlineKey = cfg.inlineKeys.find(k => isTreeVisible(k, cfg) && k in obj && Array.isArray(obj[k]));
      if (inlineKey) {
        const arr = obj[inlineKey] as JsonValue[];
        const template = arr.length > 0 ? cloneShape(arr[0]) : {};
        next = setAt(doc, [...selPath, inlineKey], [...arr, template]);
      } else {
        const key = window.prompt("New key name:");
        if (!key?.trim()) return;
        const existingVals = Object.values(obj);
        const template = existingVals.length > 0 ? cloneShape(existingVals[0]) : "";
        next = setAt(doc, selPath, { ...obj, [key.trim()]: template });
      }
    }
    if (next !== null) {
      handleDocChange(next);
      saveDoc(next);
    }
  };

  const removeNode = () => {
    if (!selPath || !selPath.length) return;
    const next = delAt(doc, selPath);
    handleDocChange(next);
    saveDoc(next);
    let parentPath = selPath.slice(0, -1);
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

  const moveUp = () => {
    if (!selPath?.length) return;
    const n = swapAt(doc, selPath, -1);
    handleDocChange(n);
    saveDoc(n);
  };

  const moveDown = () => {
    if (!selPath?.length) return;
    const n = swapAt(doc, selPath, 1);
    handleDocChange(n);
    saveDoc(n);
  };

  const expandAll = () => setExpanded(new Set(collectIds(forest, 999)));
  const collapseAll = () => setExpanded(new Set());

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
    if (pathId(dragPath) === pathId(targetPath) || isAncestorPath(dragPath, targetPath)) return;
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
    const parentVal = parentPath.length ? getAt(doc, parentPath) : null;
    const inheritedComponents = Array.isArray(parentVal)
      ? parentVal.filter(
          item => item !== null
            && typeof item === "object"
            && !Array.isArray(item)
            && (item as Record<string, JsonValue>).rel === "elaborate",
        )
      : [];
    setShowWireframe(true);
    setWireframeText("");
    setLoadingWireframe(true);
    try {
      const res = await fetch("/api/treeEditor/wireframe", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ nodeSubtree: selVal, inheritedComponents, stream: true }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let wireframe = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines[lines.length - 1];
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as { chunk?: string; error?: string };
            if (data.chunk) {
              wireframe += data.chunk;
              flushSync(() => setWireframeText(wireframe));
            } else if (data.error) {
              setWireframeText(`Error: ${data.error}`);
              return;
            }
          } catch {
            // Ignore malformed SSE lines.
          }
        }
      }
      if (!wireframe) setWireframeText("No wireframe generated");
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
      if ((e.ctrlKey || e.metaKey)
        && e.key === "z"
        && !(e.target instanceof HTMLInputElement)
        && !(e.target instanceof HTMLTextAreaElement)) {
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
  }), [
    isDragging,
    dropTargetId,
    dropInvalid,
    dropGapTarget,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleGapDragOver,
    handleGapDragLeave,
    handleGapDrop,
  ]);

  const createProject = async () => {
    const name = window.prompt("New project name:");
    if (!name) return;
    const norm = name.trim().replace(/\.json$/i, "");
    if (!norm || norm.includes("/") || norm.includes("\\") || norm.includes("..")) {
      alert("Invalid name");
      return;
    }
    if (projects.includes(norm)) {
      await loadProject(norm);
      return;
    }
    await fetch("/api/treeEditor/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ project: norm, document: {} }),
    });
    await loadProject(norm);
  };

  const backup = () => {
    if (!project) return;
    fetch("/api/treeEditor/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ project }),
    }).catch(() => {});
  };

  const breadcrumb = !selPath?.length
    ? "Document root"
    : (() => {
        const caps = breadcrumbCaps(forest, selPath);
        return caps.length ? caps.join(" › ") : selPath.join(" › ");
      })();

  const value = useMemo<StateValue>(() => ({
    cfg,
    doc,
    forest,
    selPath,
    selId,
    selVal,
    selKind,
    projects,
    project,
    loaded,
    keyInput,
    setKeyInput,
    undoDoc,
    dirty,
    saveError,
    enableWireframe,
    enableBackup,
    showWireframe,
    setShowWireframe,
    wireframeText,
    loadingWireframe,
    dnd,
    handleSel,
    handleToggle,
    handleDocChange,
    handleValChange,
    handleRenameKey,
    addRoot,
    addSub,
    removeNode,
    moveUp,
    moveDown,
    expandAll,
    collapseAll,
    handleUndo,
    handleWireframe,
    saveDoc,
    loadProject,
    createProject,
    backup,
    breadcrumb,
  }), [
    cfg,
    doc,
    forest,
    selPath,
    selId,
    selVal,
    selKind,
    projects,
    project,
    loaded,
    keyInput,
    undoDoc,
    dirty,
    saveError,
    enableWireframe,
    enableBackup,
    showWireframe,
    wireframeText,
    loadingWireframe,
    dnd,
    saveDoc,
    loadProject,
    breadcrumb,
  ]);

  return (
    <TreeEditorStateContext.Provider value={value}>
      <div className="tree-editor-scope" style={{ display: "contents" }}>
        {children}
        <WireframeOverlay />
      </div>
      <TreeEditorStyles />
    </TreeEditorStateContext.Provider>
  );
}

export function TreeEditorHeader() {
  const {
    project,
    projects,
    dirty,
    loadProject,
    createProject,
    saveDoc,
  } = useTreeEditorState();

  return (
    <div className="header">
      <h1>Tree Editor</h1>
      <div className="project-picker">
        <label>
          <span>Project:</span>
          <select
            value={project ?? ""}
            onChange={e => {
              if (e.target.value === "__new__") {
                void createProject();
                return;
              }
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
        className={`save-btn${dirty ? " dirty" : ""}`}
        disabled={!project}
        onClick={() => saveDoc()}
        title={dirty ? "Unsaved changes — click to save" : "No unsaved changes"}
      >
        {dirty ? "● Save" : "Saved"}
      </button>
    </div>
  );
}

export function TreeEditorTree({ showToolbar = true }: TreeEditorTreeProps = {}) {
  const {
    forest,
    selId,
    selKind,
    loaded,
    project,
    undoDoc,
    enableBackup,
    dnd,
    handleSel,
    handleToggle,
    addRoot,
    addSub,
    moveUp,
    moveDown,
    removeNode,
    expandAll,
    collapseAll,
    backup,
    handleUndo,
  } = useTreeEditorState();

  return (
    <div className="tree-area">
      {showToolbar && (
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
      )}
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
                    editable={showToolbar}
                  />
                ))}
              </ul>
            )}
      </div>
    </div>
  );
}

export function TreeEditorNodeForm() {
  const {
    cfg,
    doc,
    selPath,
    selVal,
    selKind,
    keyInput,
    setKeyInput,
    enableWireframe,
    handleWireframe,
    handleRenameKey,
    handleValChange,
    handleDocChange,
    addSub,
    saveDoc,
    breadcrumb,
  } = useTreeEditorState();

  const panel = () => {
    if (!selPath || !selPath.length) {
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
            <button className="wireframe-btn" onClick={() => { void handleWireframe(); }}>
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

    const key = String(selPath[selPath.length - 1]);
    return (
      <>
        {keyField}
        <PrimField
          label={fieldLabel(key, cfg)}
          val={selVal as JsonPrimitive}
          onChange={nv => handleValChange(selPath, nv)}
          longTextThreshold={cfg.longTextThreshold}
        />
      </>
    );
  };

  return (
    <div className="card" onBlur={() => saveDoc()}>
      <h2>{breadcrumb}</h2>
      {panel()}
      {selPath && selPath.length > 0 && (
        <div className="meta">Path: <code>{JSON.stringify(selPath)}</code></div>
      )}
    </div>
  );
}

function SaveError() {
  const { saveError } = useTreeEditorState();
  if (!saveError) return null;
  return (
    <div className="save-error" role="alert">
      <strong>Save rejected:</strong>
      <ul>{saveError.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </div>
  );
}

function WireframeOverlay() {
  const {
    enableWireframe,
    showWireframe,
    setShowWireframe,
    wireframeText,
    loadingWireframe,
    breadcrumb,
  } = useTreeEditorState();
  if (!enableWireframe || !showWireframe) return null;

  return (
    <div className="wireframe-overlay" onClick={() => setShowWireframe(false)}>
      <div className="wireframe-modal" onClick={e => e.stopPropagation()}>
        <div className="wireframe-header">
          <h2>✦ Wireframe — {breadcrumb}</h2>
          <button onClick={() => setShowWireframe(false)}>✕ Close</button>
        </div>
        <div className="wireframe-body">
          {loadingWireframe && !wireframeText
            ? <div className="wireframe-loading">Generating wireframe…</div>
            : <pre>{wireframeText}{loadingWireframe ? "▌" : ""}</pre>}
        </div>
      </div>
    </div>
  );
}

export function ComposableTreeEditorApp({
  showHeader = true,
  showToolbar = true,
  ...providerProps
}: ComposableTreeEditorAppProps = {}) {
  return (
    <TreeEditorProvider {...providerProps}>
      <div className="page" dir="ltr">
        {showHeader && <TreeEditorHeader />}
        <SaveError />
        <div className="content">
          <section className="left">
            <TreeEditorTree showToolbar={showToolbar} />
          </section>
          <section className="right">
            <TreeEditorNodeForm />
          </section>
        </div>
      </div>
    </TreeEditorProvider>
  );
}

function TreeEditorStyles() {
  return <style dangerouslySetInnerHTML={{ __html: `
    .tree-editor-scope, .tree-editor-scope * { box-sizing: border-box; }
    .tree-editor-scope .page { min-height: 100vh; background: #f6f7fb; color: #0f172a; padding: 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
    .tree-editor-scope .header { max-width: 1200px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .tree-editor-scope .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .tree-editor-scope .project-picker label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
    .tree-editor-scope .project-picker span { font-weight: 600; }
    .tree-editor-scope .project-picker select { min-width: 180px; }
    .tree-editor-scope .save-btn { font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #64748b; cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s; }
    .tree-editor-scope .save-btn.dirty { background: #ef4444; color: #fff; border-color: #dc2626; box-shadow: 0 0 0 3px rgba(239,68,68,.25); }
    .tree-editor-scope .save-btn.dirty:hover { background: #dc2626; }
    .tree-editor-scope .save-btn:disabled { opacity: .45; cursor: not-allowed; }
    .tree-editor-scope .save-error { max-width: 1200px; margin: 0 auto 12px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px; padding: 10px 14px; font-size: 13px; }
    .tree-editor-scope .save-error ul { margin: 4px 0 0; padding-left: 18px; }
    .tree-editor-scope .content { max-width: 1200px; margin: 0 auto; display: flex; gap: 16px; align-items: stretch; }
    .tree-editor-scope .left { flex: 0 0 38%; max-width: 38%; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 120px); }
    .tree-editor-scope .right { flex: 1; }
    .tree-editor-scope .tree-area { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
    .tree-editor-scope .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; min-height: 200px; }
    .tree-editor-scope .card h2 { margin: 0 0 14px; font-size: 13px; color: #64748b; font-weight: 600; word-break: break-all; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
    .tree-editor-scope .placeholder { color: #64748b; font-size: 14px; }
    .tree-editor-scope .meta { margin-top: 16px; font-size: 12px; color: #94a3b8; }
    .tree-editor-scope .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .tree-editor-scope .field > label { font-size: 12px; color: #475569; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
    .tree-editor-scope .key-field { border-bottom: 2px solid #e0e7ff; padding-bottom: 14px; margin-bottom: 16px; }
    .tree-editor-scope .key-field > label { color: #6366f1; }
    .tree-editor-scope .nested { margin-left: 12px; padding-left: 12px; border-left: 2px solid #e2e8f0; margin-top: 4px; padding-top: 4px; }
    .tree-editor-scope .obj-arr-item { margin-bottom: 10px; }
    .tree-editor-scope .obj-arr-item-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
    .tree-editor-scope .obj-arr-item-header button { padding: 0 6px; font-size: 12px; line-height: 1.6; }
    .tree-editor-scope .nested-note { font-size: 12px; color: #94a3b8; padding: 6px 10px; background: #f8fafc; border-radius: 6px; border: 1px dashed #e2e8f0; }
    .tree-editor-scope .arr-row { display: flex; gap: 4px; margin-bottom: 4px; }
    .tree-editor-scope .arr-row input { flex: 1; }
    .tree-editor-scope .add-btn { font-size: 12px; color: #6366f1; border: 1px dashed #c7d2fe; background: #eef2ff; border-radius: 6px; padding: 4px 12px; cursor: pointer; margin-top: 4px; }
    .tree-editor-scope .add-btn:hover { background: #e0e7ff; }
    .tree-editor-scope .rel-elaborate-icon { color: #8b5cf6; font-size: 10px; }
    .tree-editor-scope .rel-field { border: 1px solid #e0e7ff; border-radius: 8px; padding: 10px 12px; background: #f5f3ff; margin-bottom: 16px; }
    .tree-editor-scope .rel-field > label { color: #7c3aed !important; }
    .tree-editor-scope input, .tree-editor-scope textarea, .tree-editor-scope select { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 14px; outline: none; width: 100%; font-family: inherit; }
    .tree-editor-scope input:focus, .tree-editor-scope textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    .tree-editor-scope button { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
    .tree-editor-scope button:hover:not(:disabled) { background: #f8fafc; }
    .tree-editor-scope button:disabled { opacity: .4; cursor: not-allowed; }
    .tree-editor-scope .toolbar { display: flex; align-items: center; gap: 4px; padding: 6px; flex-wrap: wrap; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
    .tree-editor-scope .toolbar button { padding: 4px 8px; font-size: 12px; }
    .tree-editor-scope .tree { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 10px; overflow: auto; flex: 1; min-height: 300px; }
    .tree-editor-scope .tree-root { list-style: none; margin: 0; padding: 0; }
    .tree-editor-scope .row { display: flex; align-items: center; gap: 4px; padding: 5px 4px; border-radius: 6px; cursor: default; }
    .tree-editor-scope .row:hover { background: #f8fafc; }
    .tree-editor-scope .row.selected { background: #eef2ff; outline: 1px solid #c7d2fe; }
    .tree-editor-scope .toggle { width: 16px; text-align: center; font-size: 11px; color: #475569; cursor: pointer; user-select: none; flex-shrink: 0; }
    .tree-editor-scope .kind-icon { font-size: 10px; color: #64748b; font-family: monospace; min-width: 20px; flex-shrink: 0; }
    .tree-editor-scope .type-badge { font-size: 10px; color: #fff; border-radius: 3px; padding: 1px 5px; font-weight: 700; letter-spacing: .4px; flex-shrink: 0; line-height: 1.8; white-space: nowrap; }
    .tree-editor-scope .cap { font-size: 14px; cursor: pointer; line-height: 1.5; color: #020617; }
    .tree-editor-scope .cap.bold { font-weight: 700; }
    .tree-editor-scope .children { margin-left: 18px; padding-left: 6px; border-left: 1px solid #f1f5f9; list-style: none; margin-top: 0; padding-top: 0; }
    .tree-editor-scope .row[draggable="true"] { cursor: grab; }
    .tree-editor-scope .row[draggable="true"]:active { cursor: grabbing; }
    .tree-editor-scope .row.drop-target { background: #dcfce7 !important; outline: 1px solid #86efac; }
    .tree-editor-scope .row.drop-invalid { background: #fee2e2 !important; outline: 1px solid #fca5a5; }
    .tree-editor-scope .drop-gap { list-style: none; height: 2px; border-radius: 3px; margin: 0; transition: height 0.1s, background 0.1s; }
    .tree-editor-scope .drop-gap.dragging { height: 6px; }
    .tree-editor-scope .drop-gap.active { background: #3b82f6; height: 6px; }
    .tree-editor-scope .wireframe-btn { margin-bottom: 14px; background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600; cursor: pointer; font-size: 13px; }
    .tree-editor-scope .wireframe-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.65); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 24px; overflow-y: auto; }
    .tree-editor-scope .wireframe-modal { background: #fff; border-radius: 12px; width: 90vw; display: flex; flex-direction: column; box-shadow: 0 25px 50px rgba(0,0,0,.4); margin-top: 24px; }
    .tree-editor-scope .wireframe-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding: 16px 24px; position: sticky; top: 0; background: #fff; border-radius: 12px 12px 0 0; z-index: 1; }
    .tree-editor-scope .wireframe-header h2 { margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; }
    .tree-editor-scope .wireframe-body { padding: 24px; }
    .tree-editor-scope .wireframe-body pre { font-size: 12px; line-height: 1.6; font-family: monospace; background: #f8fafc; padding: 16px; border-radius: 8px; white-space: pre-wrap; margin: 0; border: 1px solid #e2e8f0; overflow-x: hidden; max-width: 100%; word-break: break-word; }
    .tree-editor-scope .wireframe-loading { text-align: center; padding: 60px; color: #64748b; font-size: 14px; }

    .dark .tree-editor-scope .page { background: #0a0a0a; color: #f1f5f9; }
    .dark .tree-editor-scope .header h1 { color: #f8fafc; }
    .dark .tree-editor-scope .project-picker label { color: #cbd5e1; }
    .dark .tree-editor-scope .save-btn { background: #1f1f1f; color: #94a3b8; border-color: #444; }
    .dark .tree-editor-scope .save-btn.dirty { background: #ef4444; color: #fff; border-color: #dc2626; }
    .dark .tree-editor-scope .card { background: #161616; border-color: #333; }
    .dark .tree-editor-scope .card h2 { color: #94a3b8; border-bottom-color: #262626; }
    .dark .tree-editor-scope .placeholder, .dark .tree-editor-scope .meta { color: #94a3b8; }
    .dark .tree-editor-scope .field > label { color: #cbd5e1; }
    .dark .tree-editor-scope .key-field { border-bottom-color: #3730a3; }
    .dark .tree-editor-scope .key-field > label { color: #a5b4fc; }
    .dark .tree-editor-scope .nested { border-left-color: #333; }
    .dark .tree-editor-scope .obj-arr-item-header { color: #64748b; }
    .dark .tree-editor-scope .nested-note { background: #1a1a1a; border-color: #333; color: #94a3b8; }
    .dark .tree-editor-scope input, .dark .tree-editor-scope textarea, .dark .tree-editor-scope select { background: #1f1f1f; color: #f1f5f9; border-color: #444; }
    .dark .tree-editor-scope input:focus, .dark .tree-editor-scope textarea:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,.2); }
    .dark .tree-editor-scope button { background: #1f1f1f; color: #f1f5f9; border-color: #444; }
    .dark .tree-editor-scope button:hover:not(:disabled) { background: #2a2a2a; }
    .dark .tree-editor-scope .toolbar, .dark .tree-editor-scope .tree { background: #161616; border-color: #333; }
    .dark .tree-editor-scope .row:hover { background: #1f2937; }
    .dark .tree-editor-scope .row.selected { background: #1e293b; outline-color: #3b82f6; }
    .dark .tree-editor-scope .toggle, .dark .tree-editor-scope .kind-icon { color: #94a3b8; }
    .dark .tree-editor-scope .cap { color: #f8fafc; }
    .dark .tree-editor-scope .children { border-left-color: #262626; }
    .dark .tree-editor-scope .add-btn { background: #1e1b4b; border-color: #3730a3; color: #a5b4fc; }
    .dark .tree-editor-scope .add-btn:hover { background: #312e81; }
    .dark .tree-editor-scope .row.drop-target { background: #14532d !important; outline-color: #22c55e; }
    .dark .tree-editor-scope .row.drop-invalid { background: #450a0a !important; outline-color: #ef4444; }
    .dark .tree-editor-scope .save-error { background: #450a0a; border-color: #7f1d1d; color: #fca5a5; }
  ` }} />;
}
