"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Wifi, WifiOff, Check, X, Copy, Terminal, Download } from "lucide-react";
import type { ServerStatus } from "@/lib/types";
import { EXPECTED_VERSION } from "@/lib/format";

const INSTALL_CMD = "curl -fsSL https://raw.githubusercontent.com/assada/claude-dash/master/agent/install.sh | bash";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={(e) => e.key === "Enter" && copy()}
      className="group relative flex items-center gap-3 rounded-lg border border-surface-3 bg-[#0d0d0d] px-4 py-3 transition-colors hover:border-border-hover"
    >
      <span className="shrink-0 text-text-faint">$</span>
      <code className="flex-1 overflow-x-auto text-[12.5px] text-text-secondary hide-scrollbar whitespace-nowrap">
        {command}
      </code>
      <span
        className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-200 ${
          copied
            ? "bg-ok/15 text-ok"
            : "bg-surface-2 text-text-faint group-hover:text-text-muted"
        }`}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </span>
    </div>
  );
}

interface ServerForm {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
}

export default function SettingsPage() {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [editingServer, setEditingServer] = useState<ServerForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingServer, setUpdatingServer] = useState<string | null>(null);

  const handleUpdate = async (serverId: string) => {
    setUpdatingServer(serverId);
    try {
      await fetch("/api/servers/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId }),
      });
    } catch (e) {
      console.error("[settings] Failed to update agent:", e);
    }
    // The agent will restart — wait a bit then clear
    setTimeout(() => setUpdatingServer(null), 8000);
  };

  const fetchServers = async () => {
    try {
      const res = await fetch("/api/servers");
      const data = await res.json();
      setServers(data.servers || []);
    } catch (e) {
      console.error("[settings] Failed to fetch servers:", e);
    }
  };

  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSave = async () => {
    if (!editingServer) return;
    setSaving(true);
    try {
      await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingServer),
      });
      setEditingServer(null);
      setIsNew(false);
      await fetchServers();
    } catch (e) {
      console.error("[settings] Failed to save server:", e);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this server?")) return;
    try {
      await fetch(`/api/servers?id=${id}`, { method: "DELETE" });
      await fetchServers();
    } catch (e) {
      console.error("[settings] Failed to delete server:", e);
    }
  };

  return (
    <div className="min-h-screen bg-surface-0 text-foreground">
      <div className="noise-overlay" />

      <header className="sticky top-0 z-40 backdrop-blur bg-surface-0/85 border-b border-surface-1">
        <div className="flex items-center gap-3 px-6 py-3">
          <Link href="/" className="btn-ghost flex items-center gap-1 text-[13px] no-underline">
            <ArrowLeft size={14} /> Back
          </Link>
          <span className="text-[17px] font-semibold text-text-secondary">Settings</span>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6 max-w-3xl mx-auto relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[15px] font-semibold text-text-secondary">Servers</span>
          <button
            onClick={() => {
              setEditingServer({ id: "", name: "", host: "", port: 9100, token: "" });
              setIsNew(true);
            }}
            className="btn-skin flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium"
          >
            <Plus size={14} /> Add Server
          </button>
        </div>

        {/* Server list */}
        <div className="flex flex-col gap-2 mb-6">
          {servers.map((server) => {
            const outdated =
              server.online &&
              server.agentVersion &&
              EXPECTED_VERSION !== "dev" &&
              server.agentVersion !== "dev" &&
              server.agentVersion !== EXPECTED_VERSION;

            return (
              <div key={server.id} className="panel flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text-primary">{server.name}</div>
                  <div className="text-[11px] text-text-faint mt-0.5 flex items-center gap-2">
                    <span>{server.host}:{server.port}</span>
                    {server.online && server.agentVersion && (
                      <span className={outdated ? "text-orange-500" : ""}>
                        {server.agentVersion}
                      </span>
                    )}
                  </div>
                </div>
                {server.online ? (
                  <span className="flex items-center gap-1 text-[11px] text-ok shrink-0">
                    <Wifi size={11} /> online
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-warn shrink-0">
                    <WifiOff size={11} /> offline
                  </span>
                )}
                {outdated && (
                  <button
                    onClick={() => handleUpdate(server.id)}
                    disabled={updatingServer === server.id}
                    className="btn-skin flex items-center gap-1 px-2.5 py-1 text-[11px] !text-orange-500 shrink-0"
                    title={`Update from ${server.agentVersion} to ${EXPECTED_VERSION}`}
                  >
                    <Download size={11} />
                    {updatingServer === server.id ? "Updating..." : "Update"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditingServer({
                      id: server.id, name: server.name,
                      host: server.host, port: server.port, token: "",
                    });
                    setIsNew(false);
                  }}
                  className="btn-skin px-2.5 py-1 text-[11px] !text-text-muted shrink-0"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(server.id)}
                  className="btn-danger p-1.5 shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          {servers.length === 0 && (
            <div className="py-4 text-[13px] text-text-faint italic">
              No servers configured. Add one to get started.
            </div>
          )}
        </div>

        {/* Agent setup */}
        <div className="mb-6 rounded-xl border border-surface-2 bg-surface-1/60 p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-surface-2 border border-surface-3">
              <Terminal size={14} className="text-text-muted" />
            </div>
            <span className="text-[13px] font-semibold text-text-secondary">Agent Setup</span>
          </div>
          <p className="text-[12.5px] text-text-muted leading-relaxed mb-3">
            Run this on any machine to install the agent. It downloads the binary, walks you through
            config, and sets up autostart.
          </p>
          <CopyCommand command={INSTALL_CMD} />
        </div>

        {/* Edit form */}
        {editingServer && (
          <div className="surface p-6">
            <span className="block text-[15px] font-semibold text-text-secondary mb-4">
              {isNew ? "Add Server" : "Edit Server"}
            </span>
            <div className="flex flex-col gap-4" data-1p-ignore data-lpignore="true">
              <div>
                <label className="label">Name</label>
                <input
                  type="text"
                  value={editingServer.name}
                  onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
                  placeholder="My Server"
                  autoComplete="off"
                  data-1p-ignore
                  className="input"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Tailscale IP / Host</label>
                  <input
                    type="text"
                    value={editingServer.host}
                    onChange={(e) => setEditingServer({ ...editingServer, host: e.target.value })}
                    placeholder="100.64.1.10"
                    autoComplete="off"
                    data-1p-ignore
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input
                    type="number"
                    value={editingServer.port}
                    onChange={(e) => setEditingServer({ ...editingServer, port: parseInt(e.target.value) || 9100 })}
                    autoComplete="off"
                    data-1p-ignore
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="label">Auth Token</label>
                <input
                  type="text"
                  value={editingServer.token}
                  onChange={(e) => setEditingServer({ ...editingServer, token: e.target.value })}
                  placeholder="Leave blank to keep current"
                  autoComplete="off"
                  data-1p-ignore
                  className="input"
                  style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setEditingServer(null); setIsNew(false); }}
                  className="btn-skin flex items-center gap-1 px-3.5 py-2 text-[13px] font-medium !text-text-muted"
                >
                  <X size={13} /> Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editingServer.name || !editingServer.host}
                  className="btn-primary flex items-center gap-1 px-3.5 py-2 text-[13px] font-medium"
                >
                  <Check size={13} /> {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
