# tree-editor

A generic, schema-inferring JSON tree editor: collapsible tree on the left,
edit form on the right, drag-and-drop reparenting, undo. No fixed schema in
code — it infers structure from a few conventions in the data itself
(`children`/`items`/`nodes`/`elements`/`list`/`entries` arrays are shown as
hierarchy; `caption`/`title`/`name`/`label`/`id` become the node title; a
`type` string becomes a colored badge). See `src/client/TreeEditorApp.tsx`
for the exact rules.

This package holds **only the generic engine — zero data, zero host-specific
logic.** Every consumer supplies its own thin wiring:

## What you get

- `tree-editor/client` — `TreeEditorApp`, a `"use client"` React component.
  Mount it (or a one-line re-export of it) at whatever page path you want.
- `tree-editor/server` — `createTreeEditorRoutes(adapter)`, a factory that
  returns `{ GET, POST }` Next.js route handlers. Mount them (or a thin
  wrapper around them) at `/api/treeEditor/tree`.

## What you must supply

Next.js requires `page.tsx` and `route.ts` to physically exist inside your
own app's `app/` directory — a package can't be scanned by its router. So
each consumer keeps two tiny files:

```tsx
// app/.../page.tsx
export { TreeEditorApp as default } from "tree-editor/client";
```

```ts
// app/api/treeEditor/tree/route.ts
import { createTreeEditorRoutes } from "tree-editor/server";
export const { GET, POST } = createTreeEditorRoutes(myAdapter);
```

`myAdapter` (a `ProjectAdapter`, see `src/server/types.ts`) is the one thing
that's genuinely different per host — where your project files live, and
optionally how to validate them:

```ts
interface ProjectAdapter {
  listProjects(): Promise<string[]>;
  projectFilePath(project: string): string;
  ensureDataDir?(): Promise<void>;
  validate?(project: string, document: unknown): string[] | null | Promise<string[] | null>;
}
```

`createDefaultAdapter()` (from `tree-editor/server`) reproduces the tool's
original behavior — a flat `storage/models/<project>.json` directory, no
validation — for hosts that are fine with that.

## Auth

Also host-specific, on purpose — not part of this package:

- **Client:** pass `authHeaders={() => ({...})}` to `TreeEditorApp` if your
  API requires a bearer token or similar. Omit it for a local/no-auth tool.
- **Server:** wrap the routes returned by `createTreeEditorRoutes` in your
  own auth check before calling them:
  ```ts
  const { GET: baseGET, POST: basePOST } = createTreeEditorRoutes(myAdapter);
  export async function GET(req) {
    const denied = await requireAdmin(req);
    return denied ?? baseGET(req);
  }
  ```

## Optional features

`enableWireframe` and `enableBackup` props on `TreeEditorApp` are both
`false` by default. Turn one on only if you also implement the matching
route yourself (`/api/treeEditor/wireframe`, `/api/treeEditor/backup`) —
neither is part of this package.

## UI config ("pack")

The tree/form formatting rules described above (which array keys count as
hierarchy, which fields become a node's title, badge colors, …) are all
driven by an optional `uiConfig` prop — a plain JSON-shaped object you own
and bring as your own "pack":

```tsx
import { TreeEditorApp, type TreeEditorUiConfig } from "tree-editor/client";
import myPack from "./tree-editor.config.json";

const uiConfig: TreeEditorUiConfig = myPack;

export default function Page() {
  return <TreeEditorApp uiConfig={uiConfig} />;
}
```

Every field is optional, and **omitting `uiConfig` entirely reproduces the
tool's original, hardcoded behavior exactly.** Override only what you need:

| Field | Controls | Default |
|---|---|---|
| `inlineKeys` | Array keys whose items are hoisted directly as children of the parent node, instead of showing the array as its own node | `["children","items","nodes","elements","list","entries"]` |
| `treeKeys` | Allowlist of array keys permitted to appear in the tree at all (hoisted or as their own node). A key left out isn't lost — it renders as an editable list in the form instead. Omit to allow every key | *(unset — every key allowed)* |
| `captionFields` | Priority order of object fields checked for a node's display title | `["caption","title","name","label","id"]` |
| `typeColors` | Fixed `type` → badge color map | `{purpose:"#3b82f6", epic:"#8b5cf6", story:"#10b981", "acceptance-criteria":"#f59e0b"}` |
| `palette` | Fallback badge color palette, chosen by hashing the type name | 10-color default palette |
| `captionTruncateLength` | Max characters shown for a string value before truncating with "…" | `60` |
| `longTextThreshold` | String values longer than this (or with a newline) render as a textarea instead of a single-line input | `80` |
| `showOnlyArraysWithObjects` | Hide arrays whose items are all primitives from the tree (they're still editable in the form) | `true` |
| `relValues` | Selectable non-default values for a node's `rel` field, each with a tree icon and label | `[{value:"elaborate", icon:"◆", label:"elaborate (part of parent — inherited by children)"}]` |

Example: only show `children` as tree hierarchy, keep everything else
(e.g. a `notes` array) editable in the form but out of the tree:

```json
{ "treeKeys": ["children"] }
```

## Actions: delegate work to the host

Actions let a user run a host-defined operation on the selected JSON node.
Tree Editor **only handles UI, selection, saving and reloading**. The host
owns the handler, permissions, file validation and the actual processing
(Python, AI, an API call or any other service).

Use `TreeEditorApp` with `actions` / `onAction`, or use the composable
`TreeEditorProvider` when you want to place the header, tree and node form
individually.

```tsx
"use client";

import {
  TreeEditorProvider,
  TreeEditorHeader,
  TreeEditorTree,
  TreeEditorNodeForm,
  type HandlerRequest,
  type HandlerResult,
} from "tree-editor/client";

const actions = [
  { caption: "Process selected node", handlerName: "process-node" },
];

async function onAction(request: HandlerRequest): Promise<HandlerResult> {
  try {
    const response = await fetch("/api/my-tree-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json();
    return response.ok
      ? { success: true }
      : { success: false, error: result.error ?? "Action failed" };
  } catch {
    return { success: false, error: "Network error" };
  }
}

export default function Page() {
  return (
    <TreeEditorProvider actions={actions} onAction={onAction}>
      <TreeEditorHeader />
      <TreeEditorTree />
      <TreeEditorNodeForm />
    </TreeEditorProvider>
  );
}
```

**Action types (exported from `tree-editor/client`):**

```ts
type TreeAction = { caption: string; handlerName: string };
type HandlerRequest = {
  handlerName: string;
  project: string;
  nodePath: Array<string | number>;
};
type HandlerResult = { success: boolean; error?: string };
```

- `caption` is the label in the actions dropdown. `handlerName` is the
  host-defined action identifier. The host can map it to a handler and
  additional parameters via its own configuration.
- `nodePath` is the **JSON document path**, e.g.
  `["decompositionResult", "children", 0]`; it is not a dot-separated path,
  a node ID or a file path. Paths depend on the document.
- The dropdown is available when `actions` are supplied and a node is
  selected. The editor calls `onAction(request)` with the active project
  and selected node path.
- Before invoking the handler, the editor saves pending edits. If save fails,
  it does not invoke the handler.
- On `{ success: true }`, the editor reloads the project via
  `/api/treeEditor/tree` and reselects the original node if it still exists;
  if removed, it selects the closest available parent. Changes made by the
  handler must therefore be **persisted by the host before returning success**.
- On `{ success: false, error: "..." }` (or a thrown error), an error is
  displayed, and no successful-action reload takes place. The host should
  return a meaningful error rather than silently succeeding.

**Host responsibilities:** implement the action endpoint, validate the
`project`, `handlerName` and `nodePath` server-side, authorize access,
persist the updated document, and handle any backup/rollback requirements.
Never treat the client-supplied path or handler identifier as trusted.
Tree Editor does not know the host's Python engine or JSON schema.

The generic editor does **not** require `decompositionResult` or an
`output:` project name. Any such restrictions come from a particular
host's action handler, not from the Tree Editor Actions interface.

## Consuming this package

No npm registry needed — install straight from GitHub, pinned to a
tag/commit so a change here never silently breaks a consumer:

```json
"tree-editor": "github:dudisl/tree-editor#v0.1.0"
```

Next.js does not transpile `node_modules` by default. Add this package to
`transpilePackages` in your `next.config.js`:

```js
module.exports = { transpilePackages: ["tree-editor"] };
```
