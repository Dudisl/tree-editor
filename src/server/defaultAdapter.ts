import path from "path";
import { promises as fs } from "fs";
import type { ProjectAdapter } from "./types";

// Matches the tool's original, unmodified behavior: a flat directory of
// <project>.json files, no validation. Hosts that are fine with that (e.g.
// basic_web_app today) can use this as-is; hosts with their own file layout
// (e.g. orgrefactor's definition/organization.json) supply their own adapter.
export function createDefaultAdapter(
  dataDir: string = path.join(process.cwd(), "storage", "models")
): ProjectAdapter {
  return {
    async ensureDataDir() {
      await fs.mkdir(dataDir, { recursive: true });
    },
    projectFilePath(project: string): string {
      return path.join(dataDir, `${project}.json`);
    },
    async listProjects(): Promise<string[]> {
      await fs.mkdir(dataDir, { recursive: true });
      const entries = await fs.readdir(dataDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
        .map((entry) => entry.name.replace(/\.json$/i, ""))
        .sort((a, b) => a.localeCompare(b));
    },
  };
}
