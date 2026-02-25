"use client";

import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Wifi,
  WifiOff,
  Check,
  X,
} from "lucide-react";
import type { ServerStatus } from "@/lib/types";

interface ServerForm {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
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
    <div className="min-h-screen dot-grid" style={{ background: "#171717", color: "#fafafa" }}>
      <div className="noise-overlay" />

      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{
          background: "rgba(23, 23, 23, 0.85)",
          borderBottom: "1px solid #262626",
        }}
      >
        <div className="flex items-center gap-3 px-6 py-3">
          <a
            href="/"
            className="flex items-center gap-1"
            style={{
              fontSize: 13,
              color: "#737373",
              textDecoration: "none",
              transition: "color 0.2s ease",
            }}
          >
            <ArrowLeft size={14} /> Back
          </a>
          <span
            style={{ fontSize: 17, fontWeight: 600, color: "#e5e5e5" }}
          >
            Settings
          </span>
        </div>
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontSize: 15, fontWeight: 600, color: "#e5e5e5" }}>
            Servers
          </span>
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
            className="btn-skin flex items-center gap-1"
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid #404040",
              color: "#e5e5e5",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Plus size={14} /> Add Server
          </button>
        </div>

        {/* Server list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} className="mb-6">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center gap-3"
              style={{
                padding: 16,
                borderRadius: 12,
                background: "linear-gradient(135deg, #3a3a3a 0%, #262626 100%)",
                border: "1px solid #404040",
                boxShadow: "0 24px 24px -12px rgba(0, 0, 0, 0.25)",
              }}
            >
              <div className="flex-1">
                <div style={{ fontWeight: 500, fontSize: 14, color: "#fafafa" }}>
                  {server.name}
                </div>
                <div style={{ fontSize: 11, color: "#525252", marginTop: 2 }}>
                  {server.host}:{server.port}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {server.online ? (
                  <span
                    className="flex items-center gap-1"
                    style={{ fontSize: 11, color: "#4ade80" }}
                  >
                    <Wifi size={11} /> online
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1"
                    style={{ fontSize: 11, color: "#ef4444" }}
                  >
                    <WifiOff size={11} /> offline
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
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid #404040",
                  background: "#262626",
                  color: "#737373",
                  fontSize: 11,
                  transition: "all 0.2s ease",
                }}
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(server.id)}
                style={{
                  padding: 5,
                  borderRadius: 6,
                  color: "#737373",
                  transition: "all 0.2s ease",
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {servers.length === 0 && (
            <div
              className="py-4"
              style={{ fontSize: 13, color: "#525252", fontStyle: "italic" }}
            >
              No servers configured. Add one to get started.
            </div>
          )}
        </div>

        {/* Edit form */}
        {editingServer && (
          <div
            style={{
              background: "#262626",
              border: "1px solid #404040",
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 32px 40px -8px rgba(0, 0, 0, 0.55)",
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: 15,
                fontWeight: 600,
                color: "#e5e5e5",
                marginBottom: 16,
              }}
            >
              {isNew ? "Add Server" : "Edit Server"}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="grid grid-cols-2 gap-4">
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
                    ID
                  </label>
                  <input
                    type="text"
                    value={editingServer.id}
                    onChange={(e) =>
                      setEditingServer({
                        ...editingServer,
                        id: e.target.value,
                      })
                    }
                    disabled={!isNew}
                    placeholder="my-server"
                    style={{
                      ...inputStyle,
                      opacity: !isNew ? 0.5 : 1,
                    }}
                  />
                </div>
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
                    style={inputStyle}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
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
                    style={inputStyle}
                  />
                </div>
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
                    style={inputStyle}
                  />
                </div>
              </div>
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
                  style={inputStyle}
                />
              </div>
              <div className="flex justify-end gap-2" style={{ paddingTop: 4 }}>
                <button
                  onClick={() => {
                    setEditingServer(null);
                    setIsNew(false);
                  }}
                  className="flex items-center gap-1"
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "1px solid #404040",
                    background: "#262626",
                    color: "#a3a3a3",
                    fontSize: 13,
                    fontWeight: 500,
                    transition: "all 0.2s ease",
                  }}
                >
                  <X size={13} /> Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={
                    saving ||
                    !editingServer.id ||
                    !editingServer.name ||
                    !editingServer.host
                  }
                  className="btn-skin flex items-center gap-1"
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "1px solid #2563eb",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity:
                      saving ||
                      !editingServer.id ||
                      !editingServer.name ||
                      !editingServer.host
                        ? 0.4
                        : 1,
                    background:
                      "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
                  }}
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
