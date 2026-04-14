import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./Providers";
import "./globals.css";

const funnelSans = localFont({
  src: "../fonts/FunnelSans-Regular.woff2",
  variable: "--font-body",
  weight: "400",
  display: "swap",
});

const funnelDisplay = localFont({
  src: "../fonts/FunnelSans-Regular.woff2",
  variable: "--font-display",
  weight: "400",
  display: "swap",
});

const perfectlyNineties = localFont({
  src: "../fonts/PerfectlyNineties-Light.woff2",
  variable: "--font-nineties",
  weight: "300",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Coachella Planner — Your Personalized Festival Schedule",
  description:
    "Connect Spotify, get a Coachella 2026 schedule built around what you actually listen to.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${funnelSans.variable} ${funnelDisplay.variable} ${perfectlyNineties.variable} h-full`}
    >
      <body className={`${funnelSans.className} min-h-full flex flex-col`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
