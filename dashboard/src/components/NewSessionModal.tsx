"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ServerStatus } from "@/lib/types";

export function NewSessionModal({
  servers,
  defaultServerId,
  onClose,
  onSubmit,
}: {
  servers: ServerStatus[];
  defaultServerId?: string;
  onClose: () => void;
  onSubmit: (serverId: string, workdir: string, name: string) => void;
}) {
  const [serverId, setServerId] = useState(
    defaultServerId || servers.find((s) => s.online)?.id || servers[0]?.id || ""
  );
  const [workdir, setWorkdir] = useState("");
  const [name, setName] = useState("");

  const selectedServer = servers.find((s) => s.id === serverId);
  const dirs = selectedServer?.dirs || [];

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
              onChange={(e) => setServerId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
            >
              {servers.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.online}>
                    {s.name}{!s.online ? " (offline)" : ""}
                  </option>
                ))}
            </select>
          </div>

          {/* Working directory */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Working Directory
            </label>
            {dirs.length > 0 ? (
              <select
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
              >
                <option value="">Select directory...</option>
                {dirs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                placeholder="~/projects/my-app"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
              />
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
                if (serverId && workdir) {
                  onSubmit(serverId, workdir, name || "session");
                  onClose();
                }
              }}
              disabled={!serverId || !workdir}
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
