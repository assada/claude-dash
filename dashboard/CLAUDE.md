# Dashboard — Claude Code Guidelines

DO NOT COMMIT THAT FILE!

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- TypeScript, Tailwind CSS v4
- framer-motion for animations
- lucide-react for icons
- WebSocket for real-time state (custom `useSessionState` hook)

## Project Structure

```
dashboard/src/
├── app/              # Pages & API routes
├── components/
│   ├── ui/           # ← UI Kit — reusable primitives
│   └── *.tsx         # Feature components (panels, modals, drawers)
├── hooks/            # Custom hooks
└── lib/              # Types, auth, prisma
```

## UI Kit (`src/components/ui/`)

**All generic form controls and UI primitives live here.** Treat this directory as the project's internal UI kit.

### Rules

- **Never use native `<select>`, `<input type="checkbox">`, or other unstyled browser controls.** Always use (or create) a component in `ui/`.
- Each `ui/` component must be **self-contained** — no business logic, no domain types. Props should be generic (`value`, `onChange`, `options`, `label`, etc.).
- Accept `className` prop for layout overrides (margin, width). Internal styling uses the design token system.
- When you need a new form control or UI primitive (toggle, radio group, tooltip, popover, etc.) — **create it in `ui/` first**, then use it in feature components.

### Existing Components

| Component | File | Purpose |
|-----------|------|---------|
| `Select` | `ui/Select.tsx` | Custom dropdown (replaces native `<select>`) |
| `Checkbox` | `ui/Checkbox.tsx` | Styled checkbox with configurable color |

## Design System

Tokens defined in `globals.css` via `@theme inline`. Dark-only theme.

- **Surfaces**: `surface-0` (darkest) → `surface-3` (lightest)
- **Text**: `text-primary` → `text-faint` (4 levels)
- **Borders**: `border`, `border-subtle`, `border-hover`
- **CSS classes**: `.surface`, `.panel`, `.btn-skin`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.input`, `.label`

When building new components, use these tokens — don't hardcode hex colors.

## Patterns

- **Modals/overlays**: `AnimatePresence` + `motion.div` with spring pop-in (scale 0.95→1, y offset). Backdrop `bg-black/60`.
- **Global features** (command palette, notifications): Use a provider in `layout.tsx`, pages register overrides via context hooks. Don't duplicate keyboard listeners across pages.
- **State**: WebSocket real-time via `useSessionState`. Don't create duplicate WS connections unnecessarily.

## Code Style

- `"use client"` at top of every client component
- Explicit named exports (no default except pages)
- Icons from `lucide-react`, size 13–18 depending on context
- Compact Tailwind — prefer utility classes over custom CSS
