import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth, signIn } from "@/lib/auth";
import { Terminal } from "lucide-react";

const enableGitHub = process.env.ENABLE_GITHUB !== "false";
const enableGuest = process.env.ENABLE_GUEST !== "false";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/");

  const h = await headers();
  const host = h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  const origin = `${proto}://${host}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0">
      <div className="noise-overlay" />
      <div className="relative z-10 w-full max-w-sm p-8 rounded-2xl bg-surface-1 border border-surface-2">
        <div className="flex items-center gap-3 mb-6">
          <div className="icon-box w-10 h-10">
            <Terminal size={20} className="text-text-secondary" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold text-text-primary">ADHD Dashboard</h1>
            <p className="text-[12px] text-text-muted">Sign in to continue</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {enableGitHub && (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: `${origin}/` });
              }}
            >
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg bg-[#24292f] hover:bg-[#2f363d] text-white text-[13px] font-medium transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                Sign in with GitHub
              </button>
            </form>
          )}

          {enableGuest && (
            <form
              action={async () => {
                "use server";
                await signIn("guest", { redirectTo: `${origin}/` });
              }}
            >
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-primary text-[13px] font-medium transition-colors border border-surface-3"
              >
                Continue as Guest
              </button>
            </form>
          )}

          {!enableGitHub && !enableGuest && (
            <p className="text-[13px] text-red-400 text-center">
              No auth providers enabled. Set ENABLE_GITHUB=true or ENABLE_GUEST=true.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
