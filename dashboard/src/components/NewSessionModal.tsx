"use client";

import { useState, useMemo } from "react";
import { X, FolderOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  const combined = base.replace(/\/$/, "") + "/" + input;
  return normalizePath(combined);
}

/**
 * Check if path is allowed given configured dirs.
 * Allowed = path is equal to or a child (deeper) of at least one configured dir.
 */
function isPathAllowed(path: string, dirs: string[]): boolean {
  if (dirs.length === 0) return true;
  const normalized = normalizePath(path);
  if (!normalized) return false;

  return dirs.some((dir) => {
    const normalizedDir = normalizePath(dir);
    return (
      normalizedDir === normalized ||
      normalized.startsWith(normalizedDir + "/") ||
      normalizedDir === "/" ||
      normalizedDir === "~"
    );
  });
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(10, 10, 10, 0.3)",
  border: "1px solid #404040",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  color: "#fafafa",
  outline: "none",
  transition: "border-color 0.2s ease",
};

export function NewSessionModal({
  servers,
  defaultServerId,
  onClose,
  onSubmit,
}: {
  servers: ServerStatus[];
  defaultServerId?: string;
  onClose: () => void;
  onSubmit: (
    serverId: string,
    workdir: string,
    name: string,
    dangerouslySkipPermissions?: boolean
  ) => void;
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

  const resolved = useMemo(() => {
    if (!workdir.trim()) return "";
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
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{ background: "rgba(0, 0, 0, 0.6)" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{
            opacity: { duration: 0.15 },
            scale: { type: "spring", stiffness: 400, damping: 25 },
            y: { type: "spring", stiffness: 400, damping: 25 },
          }}
          className="w-full max-w-md"
          style={{
            background: "#262626",
            border: "1px solid #404040",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 32px 40px -8px rgba(0, 0, 0, 0.55)",
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <span
              style={{ fontSize: 17, fontWeight: 600, color: "#e5e5e5" }}
            >
              New Session
            </span>
            <button
              onClick={onClose}
              style={{
                padding: 4,
                borderRadius: 6,
                color: "#737373",
                transition: "color 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#e5e5e5";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#737373";
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Server */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#737373",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Server
              </label>
              <select
                value={serverId}
                onChange={(e) => {
                  setServerId(e.target.value);
                  setWorkdir("");
                }}
                style={inputStyle}
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
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#737373",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
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
                style={{
                  ...inputStyle,
                  borderColor: showError ? "#ef4444" : "#404040",
                }}
              />

              {/* Resolved path hint */}
              {resolved && workdir !== resolved && !showError && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: "#525252",
                  }}
                  className="truncate"
                >
                  {resolved}
                </div>
              )}

              {/* Error */}
              {showError && (
                <div
                  style={{ marginTop: 4, fontSize: 11, color: "#ef4444" }}
                >
                  Path must be within a configured directory
                </div>
              )}

              {/* Quick-pick dir chips */}
              {dirs.length > 0 && (
                <div
                  className="flex flex-wrap"
                  style={{ gap: 6, marginTop: 8 }}
                >
                  {dirs.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setWorkdir(dir)}
                      className="flex items-center gap-1"
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        fontSize: 11,
                        border:
                          workdir === dir
                            ? "1px solid rgba(37, 99, 235, 0.5)"
                            : "1px solid #404040",
                        background:
                          workdir === dir
                            ? "rgba(37, 99, 235, 0.15)"
                            : "#171717",
                        color:
                          workdir === dir ? "#79c0ff" : "#737373",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <FolderOpen size={10} />
                      {dir}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Session name */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#737373",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Name (optional)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="api-fix"
                style={inputStyle}
              />
            </div>

            {/* Skip permissions */}
            <label
              className="flex items-center gap-2 cursor-pointer select-none"
              style={{
                padding: "6px 0",
              }}
            >
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.target.checked)}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  accentColor: "#ef8c44",
                }}
              />
              <span style={{ fontSize: 12, color: "#737373" }}>
                --dangerously-skip-permissions
              </span>
            </label>

            {/* Submit */}
            <div className="flex justify-end gap-2" style={{ paddingTop: 4 }}>
              <button
                onClick={onClose}
                style={{
                  padding: "7px 16px",
                  borderRadius: 8,
                  border: "1px solid #404040",
                  background: "#262626",
                  color: "#a3a3a3",
                  fontSize: 13,
                  fontWeight: 500,
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#404040";
                  e.currentTarget.style.color = "#e5e5e5";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#262626";
                  e.currentTarget.style.color = "#a3a3a3";
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (serverId && resolved && isValid) {
                    onSubmit(
                      serverId,
                      resolved,
                      name || "session",
                      skipPermissions
                    );
                    onClose();
                  }
                }}
                disabled={!serverId || !resolved || !isValid}
                className="btn-skin"
                style={{
                  padding: "7px 16px",
                  borderRadius: 8,
                  border: "1px solid #2563eb",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: !serverId || !resolved || !isValid ? 0.4 : 1,
                  cursor:
                    !serverId || !resolved || !isValid
                      ? "not-allowed"
                      : "pointer",
                  background:
                    "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
                  transition: "opacity 0.2s ease",
                }}
              >
                Create
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
