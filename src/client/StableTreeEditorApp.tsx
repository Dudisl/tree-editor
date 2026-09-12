"use client";

import React, { useCallback, useRef } from "react";
import BaseTreeEditorApp, {
  type TreeEditorAppProps as BaseTreeEditorAppProps,
} from "./TreeEditorApp";
import {
  ComposableTreeEditorApp,
  type ComposableTreeEditorAppProps,
} from "./TreeEditorComponents";

export type TreeEditorAppProps = ComposableTreeEditorAppProps;

// Keep presentation props referentially stable across child state renders.
// TreeEditorApp's project-loading effect depends on callbacks/config derived
// from these props; presentation-only changes must never restart data loading.
export default function StableTreeEditorApp(props: TreeEditorAppProps = {}) {
  const uiConfigKey = JSON.stringify(props.uiConfig ?? null);
  const uiConfigKeyRef = useRef(uiConfigKey);
  const uiConfigRef = useRef(props.uiConfig);

  if (uiConfigKeyRef.current !== uiConfigKey) {
    uiConfigKeyRef.current = uiConfigKey;
    uiConfigRef.current = props.uiConfig;
  }

  const authHeadersRef = useRef(props.authHeaders);
  authHeadersRef.current = props.authHeaders;
  const stableAuthHeaders = useCallback(
    () => (authHeadersRef.current ? authHeadersRef.current() : {}),
    [],
  );

  const stableProps = {
    ...props,
    authHeaders: props.authHeaders ? stableAuthHeaders : undefined,
    uiConfig: uiConfigRef.current,
  };

  // Zero-config stays on the original component exactly, preserving the
  // existing UI and behavior. Composition flags opt into the new wrapper.
  if (props.showHeader !== undefined || props.showToolbar !== undefined) {
    return <ComposableTreeEditorApp {...stableProps} />;
  }

  const {
    showHeader: _showHeader,
    showToolbar: _showToolbar,
    ...baseProps
  } = stableProps;

  return <BaseTreeEditorApp {...(baseProps as BaseTreeEditorAppProps)} />;
}
