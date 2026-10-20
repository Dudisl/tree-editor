"use client";
import { useState } from "react";
import { TreeEditorApp, type HandlerRequest, type HandlerResult } from "../../src/client";
type Mode = "success" | "handler-error" | "throw-error" | "invalid-response" | "reload-error" | "save-error";
const ACTIONS = [
  { caption: "Append generated child", handlerName: "create" },
  { caption: "Mark node decomposed", handlerName: "decompose" },
];
export default function Page() {
  const [mode, setMode] = useState<Mode>("success");
  const [events, setEvents] = useState<string[]>([]);
  const log = (value: string) => setEvents(prev => [new Date().toLocaleTimeString() + " " + value, ...prev].slice(0, 25));
  const onAction = async (request: HandlerRequest): Promise<HandlerResult> => {
    log("onAction " + JSON.stringify(request));
    if (mode === "throw-error") throw new Error("Simulated exception");
    if (mode === "invalid-response") return {} as HandlerResult;
    const res = await fetch("/api/demo-action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, mode }),
    });
    const result = await res.json() as HandlerResult;
    log("handler result " + JSON.stringify(result));
    return result;
  };
  return <div>
    <aside style={{background:"#0f172a",color:"white",padding:16,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
      <strong>Tree Editor — Action API test host</strong>
      <label>Scenario:{" "}
        <select aria-label="Test scenario" value={mode} onChange={e => setMode(e.target.value as Mode)}>
          <option value="success">Success</option>
          <option value="handler-error">Handler returns failure</option>
          <option value="throw-error">Handler throws</option>
          <option value="invalid-response">Invalid response</option>
          <option value="reload-error">Reload fails once</option>
          <option value="save-error">Save fails</option>
        </select>
      </label>
      <span>Choose a node, then an action in the tree toolbar.</span>
    </aside>
    <TreeEditorApp actions={ACTIONS} onAction={onAction} showHeader showToolbar
      authHeaders={() => mode === "save-error" ? { "x-demo-fail-save": "1" } : {}} />
    <section style={{padding:16,fontFamily:"monospace"}}>
      <strong>Handler calls (newest first)</strong>
      <button style={{marginLeft:12}} onClick={() => setEvents([])}>Clear</button>
      <pre style={{whiteSpace:"pre-wrap"}}>{events.join("\n") || "No calls yet"}</pre>
    </section>
  </div>;
}
