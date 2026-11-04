import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three faces, each with a job.
 *
 * Instrument Serif carries the name and the headlines: a circuit app is a page of
 * technical readouts, and a serif is the one thing on screen that is allowed to
 * have a voice. Inter is the interface and every explanation, because findings
 * are read at 13-15px and Inter is built to stay clear there. JetBrains Mono
 * holds anything a person compares character by character — pin names, values,
 * netlists — where a fixed advance stops 220Ω and 22Ω from looking alike.
 *
 * The pitch deck uses the same three, so a slide and a screenshot sit together.
 */
const display = Instrument_Serif({
  // Not a variable font, so the weight is required.
  weight: "400",
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-sans-var",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-var",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sketch → Circuit",
  description:
    "Photograph a hand-drawn circuit. See it rendered in 3D, simulated, and told what is wrong with it — in plain language, before you connect the battery.",
};

export const viewport = {
  themeColor: "#07090d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-ink">{children}</body>
    </html>
  );
}
