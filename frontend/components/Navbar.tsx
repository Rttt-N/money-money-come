"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./WalletButton";
import { Coins } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/squads", label: "Squads" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30 group-hover:shadow-amber-500/50 transition-shadow">
            <Coins className="h-5 w-5 text-black" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            Money<span className="text-amber-400">Money</span>Come
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                pathname === href
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <WalletButton />
      </div>
    </nav>
  );
}
