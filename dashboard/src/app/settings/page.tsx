"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Wifi, WifiOff, Check, X, Copy, Terminal, Download, BarChart3, Cpu, FolderOpen, Server, Zap } from "lucide-react";
import type { ServerStatus } from "@/lib/types";
import { EXPECTED_VERSION, isAgentOutdated } from "@/lib/format";
import { formatCost, formatTokens } from "@/lib/pricing";

interface UsageStats {
  totals: {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalTokens: number;
    entries: number;
    cacheHitRate: number;
  };
  byModel: Array<{
    model: string;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    entries: number;
  }>;
  byDay: Array<{ day: string; cost: number; tokens: number; entries: number }>;
  byServer: Array<{
    serverId: string;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    entries: number;
    firstSeen: string;
    lastSeen: string;
  }>;
  topWorkdirs: Array<{ workdir: string; cost: number; entries: number }>;
}

function modelShortName(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

const MODEL_COLORS: Record<string, string> = {
  Opus: "#c084fc",
  Sonnet: "#60a5fa",
  Haiku: "#34d399",
};

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-surface-2 bg-surface-1/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-text-faint">{icon}</span>
        <span className="text-[11px] text-text-muted uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-[20px] font-semibold text-text-primary">{value}</div>
      {sub && <div className="text-[11px] text-text-faint mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniBar({ items }: { items: Array<{ label: string; value: number; color: string }> }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return null;
  return (
    <div className="flex rounded-full overflow-hidden h-2.5 bg-surface-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="h-full transition-all duration-300"
          style={{ width: `${(item.value / total) * 100}%`, backgroundColor: item.color }}
          title={`${item.label}: ${formatCost(item.value)}`}
        />
      ))}
    </div>
  );
}

function UsageSection({ stats, servers }: { stats: UsageStats; servers: ServerStatus[] }) {
  const t = stats.totals;
  const serverMap = new Map(servers.map((s) => [s.id, s.name]));

  const modelItems = stats.byModel
    .sort((a, b) => b.cost - a.cost)
    .map((m) => {
      const name = modelShortName(m.model);
      return { ...m, shortName: name, color: MODEL_COLORS[name] || "#737373" };
    });

  // Daily chart — last 14 days, fill gaps
  const dayMap = new Map(stats.byDay.map((d) => [d.day, d]));
  const days: Array<{ day: string; cost: number; tokens: number; entries: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    days.push(dayMap.get(key) ?? { day: key, cost: 0, tokens: 0, entries: 0 });
  }
  const maxCost = Math.max(...days.map((d) => d.cost), 0.01);

  return (
    <div className="flex flex-col gap-5">
      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<BarChart3 size={14} />} label="Total Cost" value={formatCost(t.cost)} sub={`${t.entries.toLocaleString()} API calls`} />
        <StatCard icon={<Zap size={14} />} label="Tokens" value={formatTokens(t.totalTokens)} sub={`${formatTokens(t.inputTokens)} in · ${formatTokens(t.outputTokens)} out`} />
        <StatCard icon={<Cpu size={14} />} label="Cache Hit" value={`${(t.cacheHitRate * 100).toFixed(0)}%`} sub={`${formatTokens(t.cacheReadInputTokens)} read · ${formatTokens(t.cacheCreationInputTokens)} created`} />
        <StatCard icon={<Server size={14} />} label="Servers" value={String(stats.byServer.length)} sub={`${stats.topWorkdirs.length} projects`} />
      </div>

      {/* Model breakdown */}
      {modelItems.length > 0 && (
        <div className="rounded-lg border border-surface-2 bg-surface-1/60 p-4">
          <span className="text-[12px] text-text-muted uppercase tracking-wide">By Model</span>
          <MiniBar items={modelItems.map((m) => ({ label: m.shortName, value: m.cost, color: m.color }))} />
          <div className="mt-3 flex flex-col gap-2">
            {modelItems.map((m) => (
              <div key={m.model} className="flex items-center gap-3 text-[12px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                <span className="text-text-secondary flex-1">{m.shortName}</span>
                <span className="text-text-muted w-14 text-right">{formatTokens(m.inputTokens + m.outputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens)}</span>
                <span className="text-text-primary font-medium w-16 text-right">{formatCost(m.cost)}</span>
                <span className="text-text-faint w-20 text-right">{m.entries.toLocaleString()} calls</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily cost chart */}
      {days.length > 0 && (
        <div className="rounded-lg border border-surface-2 bg-surface-1/60 p-4">
          <span className="text-[12px] text-text-muted uppercase tracking-wide">Daily Cost (last 14 days)</span>
          <div className="mt-3 flex items-end gap-[3px]" style={{ height: 96 }}>
            {days.map((d) => {
              const h = d.cost > 0 ? Math.max((d.cost / maxCost) * 80, 3) : 0;
              const date = new Date(d.day + "T12:00:00");
              const label = `${date.getDate()}`;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full group">
                  <span className="text-[9px] text-text-faint opacity-0 group-hover:opacity-100 transition-opacity mb-0.5">
                    {d.cost > 0 ? formatCost(d.cost) : ""}
                  </span>
                  <div
                    className="w-full rounded-t bg-accent/70 hover:bg-accent transition-colors"
                    style={{ height: h }}
                    title={`${d.day}: ${formatCost(d.cost)} · ${formatTokens(d.tokens)} tokens · ${d.entries} calls`}
                  />
                  <span className="text-[9px] text-text-faint mt-1">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-server breakdown */}
      {stats.byServer.length > 0 && (
        <div className="rounded-lg border border-surface-2 bg-surface-1/60 p-4">
          <span className="text-[12px] text-text-muted uppercase tracking-wide">By Server</span>
          <div className="mt-3 flex flex-col gap-2">
            {stats.byServer
              .sort((a, b) => b.cost - a.cost)
              .map((sv) => (
                <div key={sv.serverId} className="flex items-center gap-3 text-[12px]">
                  <Server size={12} className="text-text-faint shrink-0" />
                  <span className="text-text-secondary flex-1 truncate">{serverMap.get(sv.serverId) || sv.serverId}</span>
                  <span className="text-text-muted w-14 text-right">{formatTokens(sv.inputTokens + sv.outputTokens)}</span>
                  <span className="text-text-primary font-medium w-16 text-right">{formatCost(sv.cost)}</span>
                  <span className="text-text-faint w-20 text-right">{sv.entries.toLocaleString()} calls</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Top workdirs */}
      {stats.topWorkdirs.length > 0 && (
        <div className="rounded-lg border border-surface-2 bg-surface-1/60 p-4">
          <span className="text-[12px] text-text-muted uppercase tracking-wide">Top Projects by Cost</span>
          <div className="mt-3 flex flex-col gap-2">
            {stats.topWorkdirs.map((w) => (
              <div key={w.workdir} className="flex items-center gap-3 text-[12px]">
                <FolderOpen size={12} className="text-text-faint shrink-0" />
                <span className="text-text-secondary flex-1 truncate" title={w.workdir}>
                  {w.workdir}
                </span>
                <span className="text-text-primary font-medium w-16 text-right">{formatCost(w.cost)}</span>
                <span className="text-text-faint w-20 text-right">{w.entries.toLocaleString()} calls</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);

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

  const fetchUsage = async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsageStats(await res.json());
    } catch (e) {
      console.error("[settings] Failed to fetch usage:", e);
    }
  };

  useEffect(() => {
    fetchServers();
    fetchUsage();
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
              isAgentOutdated(server.agentVersion, EXPECTED_VERSION);

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

        {/* Usage statistics */}
        {usageStats && usageStats.totals.entries > 0 && (
          <div className="mb-6">
            <span className="text-[15px] font-semibold text-text-secondary block mb-4">Usage Statistics</span>
            <UsageSection stats={usageStats} servers={servers} />
          </div>
        )}

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
