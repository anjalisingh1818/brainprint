import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "BrainPrint",
  description: "Predicted attention signals and trainable mindset brains for product pitches, stored in a Relate graph.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav" aria-label="Main">
          <div className="wrap navin">
            <b>BrainPrint</b>
            <Link href="/">Pitch timeline</Link>
            <Link href="/brains">Brain Library</Link>
            <Link href="/ideas">Idea Lab</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
