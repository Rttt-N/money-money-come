import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MoneyMoneyCome — No-Loss DeFi Lottery",
  description:
    "Deposit stablecoins, earn yield, and compete in a verifiably fair weekly prize draw without risking your principal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#080808] text-white antialiased`} suppressHydrationWarning>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-white/5 py-6 text-center text-xs text-white/30">
              MoneyMoneyCome Protocol · Built on Aave V3 &amp; Chainlink VRF
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
