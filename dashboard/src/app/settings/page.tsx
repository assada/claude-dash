"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Trash2, Wifi, WifiOff, Check, X } from "lucide-react";
import type { ServerStatus } from "@/lib/types";

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

  const fetchServers = async () => {
    try {
      const res = await fetch("/api/servers");
      const data = await res.json();
      setServers(data.servers || []);
    } catch {}
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
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this server?")) return;
    try {
      await fetch(`/api/servers?id=${id}`, { method: "DELETE" });
      await fetchServers();
    } catch {}
  };

  return (
    <div className="min-h-screen bg-surface-0 text-foreground">
      <div className="noise-overlay" />

      <header className="sticky top-0 z-40 backdrop-blur bg-surface-0/85 border-b border-surface-1">
        <div className="flex items-center gap-3 px-6 py-3">
          <a href="/" className="btn-ghost flex items-center gap-1 text-[13px] no-underline">
            <ArrowLeft size={14} /> Back
          </a>
          <span className="text-[17px] font-semibold text-text-secondary">Settings</span>
        </div>
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto relative z-10">
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
          {servers.map((server) => (
            <div key={server.id} className="panel flex items-center gap-3 p-4">
              <div className="flex-1">
                <div className="text-[14px] font-medium text-text-primary">{server.name}</div>
                <div className="text-[11px] text-text-faint mt-0.5">
                  {server.host}:{server.port}
                </div>
              </div>
              {server.online ? (
                <span className="flex items-center gap-1 text-[11px] text-ok">
                  <Wifi size={11} /> online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-warn">
                  <WifiOff size={11} /> offline
                </span>
              )}
              <button
                onClick={() => {
                  setEditingServer({
                    id: server.id, name: server.name,
                    host: server.host, port: server.port, token: "",
                  });
                  setIsNew(false);
                }}
                className="btn-skin px-2.5 py-1 text-[11px] !text-text-muted"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(server.id)}
                className="btn-danger p-1.5"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {servers.length === 0 && (
            <div className="py-4 text-[13px] text-text-faint italic">
              No servers configured. Add one to get started.
            </div>
          )}
        </div>

        {/* Edit form */}
        {editingServer && (
          <div className="surface p-6">
            <span className="block text-[15px] font-semibold text-text-secondary mb-4">
              {isNew ? "Add Server" : "Edit Server"}
            </span>
            <div className="flex flex-col gap-4" data-1p-ignore data-lpignore="true">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">ID</label>
                  <input
                    type="text"
                    value={editingServer.id}
                    onChange={(e) => setEditingServer({ ...editingServer, id: e.target.value })}
                    disabled={!isNew}
                    placeholder="my-server"
                    autoComplete="off"
                    data-1p-ignore
                    className={`input ${!isNew ? "opacity-50" : ""}`}
                  />
                </div>
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
              </div>
              <div className="grid grid-cols-2 gap-4">
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
                  disabled={saving || !editingServer.id || !editingServer.name || !editingServer.host}
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
