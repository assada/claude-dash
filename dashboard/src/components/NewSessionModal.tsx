"use client";

import { useState, useMemo, useEffect } from "react";
import { X, FolderOpen, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import type { ServerStatus } from "@/lib/types";

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

function resolvePath(input: string, base: string): string {
  if (!input) return input;
  if (input.startsWith("/") || input.startsWith("~")) return normalizePath(input);
  return normalizePath(base.replace(/\/$/, "") + "/" + input);
}

function isPathAllowed(path: string, dirs: string[]): boolean {
  if (dirs.length === 0) return true;
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return dirs.some((dir) => {
    const nd = normalizePath(dir);
    return nd === normalized || normalized.startsWith(nd + "/") || nd === "/" || nd === "~";
  });
}

export function NewSessionModal({
  open,
  servers,
  defaultServerId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  servers: ServerStatus[];
  defaultServerId?: string;
  onClose: () => void;
  onSubmit: (serverId: string, workdir: string, name: string, dangerouslySkipPermissions?: boolean) => void;
}) {
  const [serverId, setServerId] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [name, setName] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setServerId(defaultServerId || servers.find((s) => s.online)?.id || servers[0]?.id || "");
      setWorkdir("");
      setName("");
      setSkipPermissions(false);
    }
  }, [open, defaultServerId, servers]);

  const selectedServer = servers.find((s) => s.id === serverId);
  const dirs = selectedServer?.dirs || [];

  const resolved = useMemo(() => {
    if (!workdir.trim()) return "";
    if (dirs.length > 0 && !workdir.startsWith("/") && !workdir.startsWith("~")) {
      return resolvePath(workdir, dirs[0]);
    }
    return normalizePath(workdir);
  }, [workdir, dirs]);

  const isValid = resolved ? dirs.length === 0 || isPathAllowed(resolved, dirs) : false;
  const showError = workdir.trim() !== "" && !isValid;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="new-session-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 flex items-center justify-center z-50 bg-black/60"
          onClick={onClose}
        >
          <motion.div
            key="new-session-content"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{
              opacity: { duration: 0.15 },
              scale: { type: "spring", stiffness: 400, damping: 25 },
            }}
            className="surface w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="flex items-center justify-between mb-5">
            <span className="text-[17px] font-semibold text-text-secondary">
              New Session
            </span>
            <button onClick={onClose} className="btn-ghost p-1">
              <X size={16} />
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {/* Server */}
            <div>
              <label className="label">Server</label>
              <Select
                value={serverId}
                options={servers.map((s) => ({
                  value: s.id,
                  label: s.name + (!s.online ? " (offline)" : ""),
                  disabled: !s.online,
                }))}
                onChange={(v) => { setServerId(v); setWorkdir(""); }}
              />
            </div>

            {/* Working directory */}
            <div>
              <label className="label">Working Directory</label>
              <input
                type="text"
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                placeholder={dirs.length > 0 ? "Select below or type a path..." : "~/projects/my-app"}
                className={`input ${showError ? "!border-warn" : ""}`}
              />
              {resolved && workdir !== resolved && !showError && (
                <div className="mt-1 text-[11px] text-text-faint truncate">{resolved}</div>
              )}
              {showError && (
                <div className="mt-1 text-[11px] text-warn">
                  Path must be within a configured directory
                </div>
              )}
              {dirs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {dirs.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setWorkdir(dir)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors ${
                        workdir === dir
                          ? "border-accent/50 bg-accent/15 text-blue-300"
                          : "border-border bg-surface-0 text-text-muted hover:text-text-secondary hover:border-border-hover"
                      }`}
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
              <label className="label">Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="api-fix"
                className="input"
              />
            </div>

            {/* Skip permissions */}
            <Checkbox
              checked={skipPermissions}
              onChange={setSkipPermissions}
              color="orange-500"
              label={
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={11} className="text-orange-400" />
                  --dangerously-skip-permissions
                </span>
              }
            />

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="btn-skin px-4 py-2 text-[13px] font-medium !text-text-muted">
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
                className="btn-primary px-4 py-2 text-[13px] font-medium"
              >
                Create
              </button>
            </div>
          </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
