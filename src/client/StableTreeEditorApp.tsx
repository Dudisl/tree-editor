"use client";

import React, { useCallback, useRef } from "react";
import BaseTreeEditorApp, { type TreeEditorAppProps } from "./TreeEditorApp";

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
    []
  );

  return (
    <BaseTreeEditorApp
      {...props}
      authHeaders={props.authHeaders ? stableAuthHeaders : undefined}
      uiConfig={uiConfigRef.current}
    />
  );
}
