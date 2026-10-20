import { NextRequest, NextResponse } from "next/server";
import { PROJECT, readDocument, writeDocument, consumeLoadFailure } from "../../../../lib/store";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  if (await consumeLoadFailure()) return NextResponse.json({ error: "Simulated reload failure" }, { status: 503 });
  const requested = req.nextUrl.searchParams.get("project");
  if (requested && requested !== PROJECT) return NextResponse.json({ error: "Unknown project" }, { status: 404 });
  return NextResponse.json({ project: PROJECT, projects: [PROJECT], document: await readDocument() });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("x-demo-fail-save") === "1") return NextResponse.json({ error: "Simulated save failure" }, { status: 500 });
  const body = await req.json() as { project?: string; document?: unknown };
  if (body.project !== PROJECT || !("document" in body))
    return NextResponse.json({ error: "Invalid save request" }, { status: 400 });
  await writeDocument(body.document);
  return NextResponse.json({ ok: true });
}
