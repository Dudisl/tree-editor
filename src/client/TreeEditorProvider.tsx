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
        .tree-editor-scope .row {
          padding: 5px 4px;
        }
        .tree-editor-scope .cap {
          font-size: 14px;
          line-height: 1.5;
        }
        .tree-editor-scope .tree-root,
        .tree-editor-scope .tree-root > li,
        .tree-editor-scope .children > li {
          margin-top: 0;
          margin-bottom: 0;
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
