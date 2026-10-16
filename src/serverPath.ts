// The graphcal executable named by the `graphcal.lsp.path` setting, with its
// `${workspaceFolder}` variables expanded. A pure function: extension.ts reads
// the setting and the open folders.

/** An open workspace folder. */
export interface Folder {
  name: string;
  fsPath: string;
}

/** The executable to start, or why the setting names none. */
export type ServerPath = { ok: true; command: string } | { ok: false; error: string };

const VARIABLE = /\$\{([^}]*)\}/g;

/**
 * The command for the configured path: `graphcal` (found on PATH) when it is
 * empty, otherwise the path with `${workspaceFolder}` replaced by the first
 * folder and `${workspaceFolder:name}` by the folder of that name. Any other
 * `${...}` is refused rather than passed on literally.
 */
export function serverPath(configured: string, folders: readonly Folder[]): ServerPath {
  if (configured === "") return { ok: true, command: "graphcal" };
  const errors: string[] = [];
  const command = configured.replace(VARIABLE, (whole, variable: string) => {
    const folder = resolveVariable(variable, folders);
    if (folder.ok) return folder.fsPath;
    errors.push(`${whole}: ${folder.error}`);
    return whole;
  });
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, command };
}

type Resolved = { ok: true; fsPath: string } | { ok: false; error: string };

function resolveVariable(variable: string, folders: readonly Folder[]): Resolved {
  if (variable === "workspaceFolder") {
    const [first] = folders;
    return first ? { ok: true, fsPath: first.fsPath } : { ok: false, error: "no folder is open" };
  }
  const named = /^workspaceFolder:(.+)$/.exec(variable);
  if (named) {
    const folder = folders.find((f) => f.name === named[1]);
    return folder
      ? { ok: true, fsPath: folder.fsPath }
      : { ok: false, error: `no open folder is named "${named[1]}"` };
  }
  return { ok: false, error: "only ${workspaceFolder} and ${workspaceFolder:name} are supported" };
}
