import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HTC",
  description: "CLI Pessoal de MX",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="h-dvh overflow-hidden antialiased">{children}</body>
    </html>
  );
}
