import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "BrainPrint",
  description: "Build persona brains by talking, then ask them all a problem at once. One Relate knowledge graph.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav" aria-label="Main">
          <div className="wrap navin">
            <b>BrainPrint</b>
            <Link href="/">Brain Panel</Link>
            <Link href="/brains">Brain Library</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
