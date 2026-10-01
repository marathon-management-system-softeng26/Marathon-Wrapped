import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marathon Wrapped",
  description: "Your race, wrapped — Soekarno Run 2027",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
