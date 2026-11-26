import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";

import { AuthGate } from "@/components/auth-gate";
import { Providers } from "@/components/providers";

import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CU Admin",
  description: "CU enterprise endpoint monitoring administration dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sourceSans.variable} antialiased`}>
        <Providers>
          <AuthGate>{children}</AuthGate>
        </Providers>
      </body>
    </html>
  );
}
