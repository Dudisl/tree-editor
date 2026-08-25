import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import type { ProjectAdapter } from "./types";
import { createDefaultAdapter } from "./defaultAdapter";

export function normalizeProjectName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim().replace(/\.json$/i, "");
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) return null;
  return trimmed;
}

// Auth is deliberately NOT handled here — it's host-specific. Wrap the
// returned GET/POST in your own route.ts with your own auth check, e.g.:
//
//   const { GET: baseGET, POST: basePOST } = createTreeEditorRoutes(myAdapter);
//   export async function GET(req) {
//     const denied = await requireAdmin(req);
//     return denied ?? baseGET(req);
//   }
export function createTreeEditorRoutes(adapter: ProjectAdapter = createDefaultAdapter()) {
  async function GET(req: NextRequest) {
    const requested = normalizeProjectName(req.nextUrl.searchParams.get("project"));
    const projects = await adapter.listProjects();
    const project = requested ?? projects[0] ?? null;
    const allProjects =
      project && !projects.includes(project)
        ? [...projects, project].sort((a, b) => a.localeCompare(b))
        : projects;

    if (!project) {
      return NextResponse.json({ document: null, project: null, projects: allProjects });
    }

    try {
      await adapter.ensureDataDir?.();
      const raw = await fs.readFile(adapter.projectFilePath(project), "utf-8");
      const document = JSON.parse(raw) as unknown;
      return NextResponse.json({ document, project, projects: allProjects });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return NextResponse.json({ document: null, project, projects: allProjects });
      }
      console.error(err);
      return NextResponse.json({ document: null, project, projects: allProjects }, { status: 500 });
    }
  }

  async function POST(req: NextRequest) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Request body must be a JSON object" }, { status: 400 });
    }

    const project = normalizeProjectName((body.project as string | undefined) ?? null);
    if (!project) {
      return NextResponse.json({ ok: false, error: "Invalid project" }, { status: 400 });
    }

    if (!("document" in body)) {
      return NextResponse.json({ ok: false, error: "Missing document field" }, { status: 400 });
    }

    const document = body.document ?? null;

    if (adapter.validate) {
      const errors = await adapter.validate(project, document);
      if (errors && errors.length) {
        return NextResponse.json({ ok: false, errors }, { status: 400 });
      }
    }

    try {
      await adapter.ensureDataDir?.();
      const filePath = adapter.projectFilePath(project);
      const tmpPath = filePath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(document, null, 2), "utf-8");
      await fs.rename(tmpPath, filePath);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error(err);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  return { GET, POST };
}
