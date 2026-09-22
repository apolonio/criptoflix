import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestão Casa",
  description: "Gestão familiar de imóveis, documentos e patrimônio.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
