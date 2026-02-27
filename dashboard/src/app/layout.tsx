import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CommandPaletteProvider } from "@/components/CommandPalette";
import { SessionStateProvider } from "@/hooks/useSessionState";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "ADHD Dashboard",
  description: "Monitor and manage Claude Code sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ background: "#171717" }}
      >
        <SessionStateProvider>
          <CommandPaletteProvider>{children}</CommandPaletteProvider>
        </SessionStateProvider>
      </body>
    </html>
  );
}
