"use client";

import { useState, useMemo } from "react";
import { X, FolderOpen } from "lucide-react";
import type { ServerStatus } from "@/lib/types";

/** Normalize a path: resolve `.` and `..` segments */
function normalizePath(path: string): string {
  if (!path) return path;

  let prefix = "";
  let rest = path;

  if (path.startsWith("~/")) {
    prefix = "~/";
    rest = path.slice(2);
  } else if (path === "~") {
    return "~";
  } else if (path.startsWith("/")) {
    prefix = "/";
    rest = path.slice(1);
  }

  const parts = rest.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return prefix + resolved.join("/");
}

/** Resolve a relative path against a base directory */
function resolvePath(input: string, base: string): string {
  if (!input) return input;
  if (input.startsWith("/") || input.startsWith("~")) {
    return normalizePath(input);
  }
  // Relative path: resolve against base
  const combined = base.replace(/\/$/, "") + "/" + input;
  return normalizePath(combined);
}

/**
 * Check if path is allowed given configured dirs.
 * Allowed = path is equal to or a child (deeper) of at least one configured dir.
 * (i.e., you cannot go ABOVE the configured dirs)
 */
function isPathAllowed(path: string, dirs: string[]): boolean {
  if (dirs.length === 0) return true;
  const normalized = normalizePath(path);
  if (!normalized) return false;

  return dirs.some((dir) => {
    const normalizedDir = normalizePath(dir);
    // Exact match or path is inside the dir
    return (
      normalizedDir === normalized ||
      normalized.startsWith(normalizedDir + "/") ||
      normalizedDir === "/" ||
      normalizedDir === "~"
    );
  });
}

export function NewSessionModal({
  servers,
  defaultServerId,
  onClose,
  onSubmit,
}: {
  servers: ServerStatus[];
  defaultServerId?: string;
  onClose: () => void;
  onSubmit: (serverId: string, workdir: string, name: string, dangerouslySkipPermissions?: boolean) => void;
}) {
  const [serverId, setServerId] = useState(
    defaultServerId ||
      servers.find((s) => s.online)?.id ||
      servers[0]?.id ||
      ""
  );
  const [workdir, setWorkdir] = useState("");
  const [name, setName] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);

  const selectedServer = servers.find((s) => s.id === serverId);
  const dirs = selectedServer?.dirs || [];

  // Resolve and validate the current workdir
  const resolved = useMemo(() => {
    if (!workdir.trim()) return "";
    // If relative and we have dirs, resolve against first dir
    if (
      dirs.length > 0 &&
      !workdir.startsWith("/") &&
      !workdir.startsWith("~")
    ) {
      return resolvePath(workdir, dirs[0]);
    }
    return normalizePath(workdir);
  }, [workdir, dirs]);

  const isValid = resolved
    ? dirs.length === 0 || isPathAllowed(resolved, dirs)
    : false;

  const showError = workdir.trim() !== "" && !isValid;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-100">New Session</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Server */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Server</label>
            <select
              value={serverId}
              onChange={(e) => {
                setServerId(e.target.value);
                setWorkdir("");
              }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.online}>
                  {s.name}
                  {!s.online ? " (offline)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Working directory */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Working Directory
            </label>
            <input
              type="text"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder={
                dirs.length > 0
                  ? "Select below or type a path..."
                  : "~/projects/my-app"
              }
              className={`w-full bg-zinc-800 border rounded px-3 py-2 text-sm text-zinc-200 ${
                showError
                  ? "border-red-500/60 focus:border-red-500"
                  : "border-zinc-700 focus:border-zinc-600"
              }`}
            />

            {/* Resolved path hint */}
            {resolved && workdir !== resolved && !showError && (
              <div className="mt-1 text-xs text-zinc-500 truncate">
                {resolved}
              </div>
            )}

            {/* Error */}
            {showError && (
              <div className="mt-1 text-xs text-red-400">
                Path must be within a configured directory
              </div>
            )}

            {/* Quick-pick dir chips */}
            {dirs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {dirs.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setWorkdir(dir)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                      workdir === dir
                        ? "bg-blue-600/30 border border-blue-500/50 text-blue-300"
                        : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                    }`}
                  >
                    <FolderOpen size={11} />
                    {dir}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Session name */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api-fix"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
            />
          </div>

          {/* Skip permissions */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-orange-500 focus:ring-orange-500/30"
            />
            <span className="text-sm text-zinc-400">
              --dangerously-skip-permissions
            </span>
          </label>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (serverId && resolved && isValid) {
                  onSubmit(serverId, resolved, name || "session", skipPermissions);
                  onClose();
                }
              }}
              disabled={!serverId || !resolved || !isValid}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-sm"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
