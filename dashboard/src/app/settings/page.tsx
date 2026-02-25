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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-sm"
          >
            <ArrowLeft size={16} /> Back
          </a>
          <h1 className="text-lg font-bold">Settings</h1>
        </div>
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Servers</h2>
          <button
            onClick={() => {
              setEditingServer({
                id: "",
                name: "",
                host: "",
                port: 9100,
                token: "",
              });
              setIsNew(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
          >
            <Plus size={14} /> Add Server
          </button>
        </div>

        {/* Server list */}
        <div className="space-y-2 mb-6">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center gap-3 p-4 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <div className="flex-1">
                <div className="font-medium">{server.name}</div>
                <div className="text-xs text-zinc-500">
                  {server.host}:{server.port}
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs">
                {server.online ? (
                  <span className="flex items-center gap-1 text-green-500">
                    <Wifi size={12} /> online
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500">
                    <WifiOff size={12} /> offline
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setEditingServer({
                    id: server.id,
                    name: server.name,
                    host: server.host,
                    port: server.port,
                    token: "",
                  });
                  setIsNew(false);
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded bg-zinc-800"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(server.id)}
                className="p-1 hover:bg-red-900 rounded text-zinc-400 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {servers.length === 0 && (
            <div className="text-zinc-600 text-sm italic py-4">
              No servers configured. Add one to get started.
            </div>
          )}
        </div>

        {/* Edit form */}
        {editingServer && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6">
            <h3 className="text-md font-semibold mb-4">
              {isNew ? "Add Server" : "Edit Server"}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    ID
                  </label>
                  <input
                    type="text"
                    value={editingServer.id}
                    onChange={(e) =>
                      setEditingServer({ ...editingServer, id: e.target.value })
                    }
                    disabled={!isNew}
                    placeholder="my-server"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={editingServer.name}
                    onChange={(e) =>
                      setEditingServer({
                        ...editingServer,
                        name: e.target.value,
                      })
                    }
                    placeholder="My Server"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Tailscale IP / Host
                  </label>
                  <input
                    type="text"
                    value={editingServer.host}
                    onChange={(e) =>
                      setEditingServer({
                        ...editingServer,
                        host: e.target.value,
                      })
                    }
                    placeholder="100.64.1.10"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={editingServer.port}
                    onChange={(e) =>
                      setEditingServer({
                        ...editingServer,
                        port: parseInt(e.target.value) || 9100,
                      })
                    }
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">
                  Auth Token
                </label>
                <input
                  type="password"
                  value={editingServer.token}
                  onChange={(e) =>
                    setEditingServer({
                      ...editingServer,
                      token: e.target.value,
                    })
                  }
                  placeholder="Leave blank to keep current"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setEditingServer(null);
                    setIsNew(false);
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={
                    saving ||
                    !editingServer.id ||
                    !editingServer.name ||
                    !editingServer.host
                  }
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm"
                >
                  <Check size={14} /> {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
