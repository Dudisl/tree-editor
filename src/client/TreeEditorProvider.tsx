"use client";

import React from "react";
import {
  TreeEditorProvider as BaseTreeEditorProvider,
  type TreeEditorProviderProps,
} from "./TreeEditorComponents";

export type { TreeEditorProviderProps } from "./TreeEditorComponents";

export function TreeEditorProvider({ children, ...props }: TreeEditorProviderProps) {
  return (
    <BaseTreeEditorProvider {...props}>
      <div className="tree-editor-base-style" style={{ display: "contents" }}>
        {children}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .tree-editor-scope .header,
        .tree-editor-scope .tree-area,
        .tree-editor-scope .tree,
        .tree-editor-scope .row,
        .tree-editor-scope .card {
          color: #0f172a;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        }

        /* Keep the extracted tree visually compact. These rules are local to
           the composable API and do not change the legacy <TreeEditorApp />. */
        .tree-editor-scope .row {
          padding: 2px 4px;
          min-height: 0;
        }
        .tree-editor-scope .cap {
          font-size: 14px;
          line-height: 1.3;
        }
        .tree-editor-scope .tree-root,
        .tree-editor-scope .tree-root > li,
        .tree-editor-scope .children > li {
          margin: 0;
          padding-top: 0;
          padding-bottom: 0;
        }
        .tree-editor-scope .drop-gap {
          height: 0;
          margin: 0;
        }
        .tree-editor-scope .drop-gap.dragging,
        .tree-editor-scope .drop-gap.active {
          height: 6px;
        }

        .dark .tree-editor-scope .header,
        .dark .tree-editor-scope .tree-area,
        .dark .tree-editor-scope .tree,
        .dark .tree-editor-scope .row,
        .dark .tree-editor-scope .card {
          color: #f1f5f9;
        }
      ` }} />
    </BaseTreeEditorProvider>
  );
}
