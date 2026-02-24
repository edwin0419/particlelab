import type { Metadata } from "next";
import { Toaster } from "sonner";

import { QueryProvider } from "@/components/providers/QueryProvider";
import { ko } from "@/i18n/ko";

import "./globals.css";

export const metadata: Metadata = {
  title: ko.app.name,
  description: ko.app.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="font-sans">
        <QueryProvider>
          <div className="min-h-screen">{children}</div>
          <Toaster richColors position="top-right" />
        </QueryProvider>
      </body>
    </html>
  );
}
