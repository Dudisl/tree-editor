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
        .tree-editor-base-style {
          color: #0f172a;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        }
        .dark .tree-editor-base-style {
          color: #f1f5f9;
        }
      ` }} />
    </BaseTreeEditorProvider>
  );
}
