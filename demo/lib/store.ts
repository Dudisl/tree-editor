import { promises as fs } from "node:fs";
import path from "node:path";
export const PROJECT = "action-demo";
const dataDir = path.join(process.cwd(), ".demo-data");
const documentPath = path.join(dataDir, "action-demo.json");
const failurePath = path.join(dataDir, ".fail-next-load");
const seed = {
  name: "Demo root", status: "ready",
  children: [{ name: "First child", outcome: "Select this node and run an action", children: [] }],
};
export async function readDocument(): Promise<unknown> {
  await fs.mkdir(dataDir, { recursive: true });
  try { return JSON.parse(await fs.readFile(documentPath, "utf8")) as unknown; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await writeDocument(seed);
    return seed;
  }
}
export async function writeDocument(doc: unknown) {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = documentPath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
  await fs.rename(tmp, documentPath);
}
export async function failNextLoad() {
  await fs.writeFile(failurePath, "1");
}
export async function consumeLoadFailure() {
  try { await fs.unlink(failurePath); return true; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export function getAt(doc: unknown, path: (string | number)[]): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (node === null || typeof node !== "object" || !(key in node)) throw new Error("Invalid node path");
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}
