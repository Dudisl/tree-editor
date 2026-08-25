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
