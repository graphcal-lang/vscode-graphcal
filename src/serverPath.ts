// The graphcal executable named by the `graphcal.lsp.path` setting, with its
// `${...}` variables expanded. A pure function: extension.ts reads the setting
// and the environment.

/** An open workspace folder. */
export interface Folder {
  name: string;
  fsPath: string;
}

/** What the variables of `graphcal.lsp.path` expand to. */
export interface PathContext {
  folders: readonly Folder[];
  userHome: string;
  /** Looked up as given: on Windows, `process.env` already ignores case. */
  env: Readonly<Record<string, string | undefined>>;
  pathSeparator: string;
}

/** The executable to start, or why the setting names none. */
export type ServerPath = { ok: true; command: string } | { ok: false; error: string };

const VARIABLE = /\$\{([^}]*)\}/g;

/**
 * The command for the configured path: `graphcal` (found on PATH) when it is
 * empty, otherwise the path with these variables replaced:
 *
 * - `${workspaceFolder}`: the first open folder;
 * - `${workspaceFolder:name}`: the open folder of that name;
 * - `${userHome}`: the user's home folder;
 * - `${env:NAME}`: the environment variable `NAME`;
 * - `${pathSeparator}` or `${/}`: the platform's path separator.
 *
 * A variable that has no value (no folder open, an unset or empty environment
 * variable) or is not one of these is refused rather than replaced by an
 * empty string or passed on literally.
 */
export function serverPath(configured: string, context: PathContext): ServerPath {
  if (configured === "") return { ok: true, command: "graphcal" };
  const errors: string[] = [];
  const command = configured.replace(VARIABLE, (whole, variable: string) => {
    const value = resolveVariable(variable, context);
    if (value.ok) return value.value;
    errors.push(`${whole}: ${value.error}`);
    return whole;
  });
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, command };
}

type Resolved = { ok: true; value: string } | { ok: false; error: string };

function resolveVariable(variable: string, context: PathContext): Resolved {
  switch (variable) {
    case "workspaceFolder": {
      const [first] = context.folders;
      return first ? { ok: true, value: first.fsPath } : { ok: false, error: "no folder is open" };
    }
    case "userHome":
      return { ok: true, value: context.userHome };
    case "pathSeparator":
    case "/":
      return { ok: true, value: context.pathSeparator };
  }
  const { kind, argument } = splitArgument(variable);
  switch (kind) {
    case "workspaceFolder": {
      const folder = context.folders.find((f) => f.name === argument);
      return folder
        ? { ok: true, value: folder.fsPath }
        : { ok: false, error: `no open folder is named "${argument}"` };
    }
    case "env": {
      const value = context.env[argument];
      if (value === undefined) return { ok: false, error: `${argument} is not set` };
      if (value === "") return { ok: false, error: `${argument} is empty` };
      return { ok: true, value };
    }
  }
  return {
    ok: false,
    error:
      "only ${workspaceFolder}, ${workspaceFolder:name}, ${userHome}, ${env:NAME}, " +
      "${pathSeparator} and ${/} are supported",
  };
}

/**
 * `kind:argument` split at its first colon. Without a colon, or with nothing
 * on either side of it, the whole variable is the kind and has no argument.
 */
function splitArgument(variable: string): { kind: string; argument: string } {
  const colon = variable.indexOf(":");
  if (colon <= 0 || colon === variable.length - 1) return { kind: variable, argument: "" };
  return { kind: variable.slice(0, colon), argument: variable.slice(colon + 1) };
}
