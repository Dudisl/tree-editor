// The one thing every host must answer for itself: where do this project's
// files live, and (optionally) is a given document valid. Everything else
// about loading/saving/backing-up stays generic in createTreeEditorRoutes.
export interface ProjectAdapter {
  listProjects(): Promise<string[]>;
  projectFilePath(project: string): string;
  // Passed the project so adapters with a per-project directory (not just a
  // shared flat one) can create the right one before a write.
  ensureDataDir?(project: string): Promise<void>;
  // Return a list of human-readable errors, or null/[] if the document is valid.
  // Omit entirely to skip validation (matches the tool's original behavior).
  validate?(project: string, document: unknown): string[] | null | Promise<string[] | null>;
}
