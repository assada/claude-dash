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

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        new URL(url);
        return url;
      } catch {
        return baseUrl;
      }
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
