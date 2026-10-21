import { NextResponse } from "next/server";
import { PROJECT, readDocument, writeDocument, getAt, failNextLoad } from "../../../lib/store";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const body = await req.json() as { project?: string; nodePath?: (string | number)[]; handlerName?: string; mode?: string };
  if (body.project !== PROJECT || !Array.isArray(body.nodePath) ||
      !body.nodePath.every(p => typeof p === "string" || (typeof p === "number" && Number.isInteger(p))) ||
      !["create","decompose"].includes(body.handlerName ?? ""))
    return NextResponse.json({ success: false, error: "Invalid action request" }, { status: 400 });
  if (body.mode === "handler-error") return NextResponse.json({ success: false, error: "Simulated handler failure" });
  await new Promise(resolve => setTimeout(resolve, 1300));
  try {
    const doc = await readDocument();
    const node = getAt(doc, body.nodePath);
    if (!node || typeof node !== "object" || Array.isArray(node))
      return NextResponse.json({ success: false, error: "Select an object node" });
    const obj = node as Record<string, unknown>;
    if (body.handlerName === "create") {
      if (!Array.isArray(obj.children)) obj.children = [];
      (obj.children as unknown[]).push({ name: "Generated " + new Date().toISOString(), outcome: "Created by demo handler", children: [] });
    } else {
      obj.outcome = "Decomposed at " + new Date().toISOString();
    }
    await writeDocument(doc);
    if (body.mode === "reload-error") await failNextLoad();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Action failed" });
  }
}
