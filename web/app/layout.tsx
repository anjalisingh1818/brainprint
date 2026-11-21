import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "BrainPrint",
  description: "Predicted attention and processing signals for product pitches, stored in a Relate graph.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
