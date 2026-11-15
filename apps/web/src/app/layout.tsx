import type { Metadata } from "next";
import { Manrope, Syne } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Juno",
  description: "One card that routes every purchase to the best rewards.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Extensions and font metrics can add attributes before hydrate.
    <html
      lang="en"
      className={`${manrope.variable} ${syne.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
