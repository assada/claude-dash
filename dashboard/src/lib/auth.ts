import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";

const providers = [];

if (process.env.ENABLE_GITHUB !== "false") {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    })
  );
}

if (process.env.ENABLE_GUEST !== "false") {
  providers.push(
    Credentials({
      id: "guest",
      name: "Guest",
      credentials: {},
      async authorize() {
        const hex = randomBytes(4).toString("hex");
        const emailHex = randomBytes(8).toString("hex");
        const user = await prisma.user.create({
          data: {
            name: `Guest-${hex}`,
            email: `guest-${emailHex}@guest.local`,
          },
        });
        return { id: user.id, name: user.name, email: user.email };
      },
    })
  );
}

// Comma-separated list of allowed emails. If set, only these users can sign in.
const allowedEmails = process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase())
  : null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      if (!allowedEmails) return true; // no whitelist — allow all
      const email = user.email?.toLowerCase();
      if (!email || !allowedEmails.includes(email)) {
        console.warn(`[auth] Blocked sign-in attempt: ${email || "no email"}`);
        return false;
      }
      return true;
    },
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const parsed = new URL(url);
        if (new URL(baseUrl).origin === parsed.origin) return url;
      } catch {}
      return baseUrl;
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
