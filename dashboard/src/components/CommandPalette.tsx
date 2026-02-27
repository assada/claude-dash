"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import {
  Terminal,
  Plus,
  LayoutGrid,
  Archive,
  Trash2,
  Settings,
  Search,
  Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { StatusIndicator } from "./StatusIndicator";
import { useSessionState } from "@/hooks/useSessionState";
import type { ServerStatus, SessionState } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Context — pages register overrides for dashboard-specific actions  */
/* ------------------------------------------------------------------ */

interface PageActions {
  onNewSession?: (serverId?: string) => void;
  onArrange?: () => void;
  onOpenArchive?: () => void;
  onClearArchive?: () => void;
  onToggleMetrics?: () => boolean | void;
}

const CommandPaletteCtx = createContext<{
  setPageActions: (a: PageActions) => void;
}>({ setPageActions: () => {} });

/** Call from any page to override default (router-based) behaviour. */
export function useCommandPaletteActions(actions: PageActions) {
  const { setPageActions } = useContext(CommandPaletteCtx);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    setPageActions(actionsRef.current);
    return () => setPageActions({});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ------------------------------------------------------------------ */
/*  Provider — drop into layout once, works on every page             */
/* ------------------------------------------------------------------ */

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pageActionsRef = useRef<PageActions>({});

  const ctxValue = useMemo(
    () => ({
      setPageActions: (a: PageActions) => {
        pageActionsRef.current = a;
      },
    }),
    []
  );

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandPaletteCtx.Provider value={ctxValue}>
      {children}
      <AnimatePresence>
        {open && (
          <PaletteUI
            key="command-palette"
            onClose={() => setOpen(false)}
            pageActions={pageActionsRef.current}
          />
        )}
      </AnimatePresence>
    </CommandPaletteCtx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  UI                                                                 */
/* ------------------------------------------------------------------ */

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  action: () => void;
}

const STATE_LABEL: Record<SessionState, string> = {
  idle: "Idle",
  working: "Working",
  needs_attention: "Needs You",
  starting: "Starting",
  dead: "Exited",
};

function PaletteUI({
  onClose,
  pageActions,
}: {
  onClose: () => void;
  pageActions: PageActions;
}) {
  const { servers, clearArchive } = useSessionState();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Sessions
    for (const server of servers) {
      for (const session of server.sessions) {
        items.push({
          id: `session-${session.id}`,
          label: `${session.name} @ ${server.name}`,
          icon: <Terminal size={16} className="text-text-muted" />,
          badge: (
            <span className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <StatusIndicator state={session.state} size={7} />
              {STATE_LABEL[session.state]}
            </span>
          ),
          action: () =>
            router.push(`/server/${server.id}/session/${session.id}`),
        });
      }
    }

    // Static actions
    items.push({
      id: "new-session",
      label: "New Session",
      icon: <Plus size={16} className="text-text-muted" />,
      action: () =>
        pageActions.onNewSession
          ? pageActions.onNewSession()
          : router.push("/"),
    });

    items.push({
      id: "arrange",
      label: "Arrange Panels",
      icon: <LayoutGrid size={16} className="text-text-muted" />,
      action: () => pageActions.onArrange?.(),
    });

    items.push({
      id: "archive",
      label: "Open Archive",
      icon: <Archive size={16} className="text-text-muted" />,
      action: () => pageActions.onOpenArchive?.(),
    });

    items.push({
      id: "clear-archive",
      label: "Clear Archive",
      icon: <Trash2 size={16} className="text-text-muted" />,
      action: () =>
        pageActions.onClearArchive
          ? pageActions.onClearArchive()
          : clearArchive(),
    });

    items.push({
      id: "toggle-metrics",
      label: "Toggle Server Metrics",
      icon: <Activity size={16} className="text-text-muted" />,
      action: () => pageActions.onToggleMetrics?.(),
    });

    items.push({
      id: "settings",
      label: "Settings",
      icon: <Settings size={16} className="text-text-muted" />,
      action: () => router.push("/settings"),
    });

    // Servers — new session on specific server
    for (const server of servers) {
      items.push({
        id: `server-${server.id}`,
        label: `New Session on "${server.name}"`,
        icon: <Plus size={16} className="text-text-muted" />,
        badge: (
          <span
            className={`text-[11px] ${server.online ? "text-green-400" : "text-text-faint"}`}
          >
            {server.online ? "online" : "offline"}
          </span>
        ),
        action: () =>
          pageActions.onNewSession
            ? pageActions.onNewSession(server.id)
            : router.push("/"),
      });
    }

    return items;
  }, [servers, pageActions, clearArchive, router]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Autofocus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const execute = useCallback(
    (item: CommandItem) => {
      onClose();
      item.action();
    },
    [onClose]
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % (filtered.length || 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) =>
          i <= 0 ? (filtered.length || 1) - 1 : i - 1
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) execute(item);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex, execute, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{
          opacity: { duration: 0.12 },
          scale: { type: "spring", stiffness: 400, damping: 25 },
        }}
        className="surface w-full max-w-lg mx-auto mt-[18vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <Search size={16} className="text-text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[15px] text-text-secondary placeholder:text-text-faint outline-none"
          />
          <kbd className="text-[11px] text-text-faint border border-border-subtle rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto max-h-[min(340px,50vh)] py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-text-faint">
              No matching commands
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onClick={() => execute(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIndex
                    ? "bg-surface-2"
                    : "hover:bg-surface-1"
                }`}
              >
                {item.icon}
                <span className="flex-1 text-[13px] text-text-secondary truncate">
                  {item.label}
                </span>
                {item.badge}
              </button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
