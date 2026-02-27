import type { Metadata } from "next";
import { Inter, Geist_Mono, Titillium_Web, Space_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { HeaderNav } from "@/components/layout/HeaderNav";

const interSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const koltav = localFont({
  variable: "--font-koltav",
  src: "../../Fonts/koltav-extended-bold-font/Koltav-Regular-BF699537d86c952.ttf",
  display: "swap",
});

const titilliumWeb = Titillium_Web({
  variable: "--font-titillium-web",
  weight: ["300", "400", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "KoryFi - On-Chain Index Funds",
  description:
    "Invest in curated crypto baskets on Solana. Diversify with one click.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${interSans.variable} ${geistMono.variable} ${koltav.variable} ${titilliumWeb.variable} ${spaceGrotesk.variable} antialiased min-h-screen bg-background`}
      >
        <Providers>
          <header className="fixed inset-x-0 top-4 z-50 px-4 pointer-events-none">
            <div
              className="mx-auto h-16 w-full max-w-5xl rounded-full border border-white/25 bg-white/[0.05] backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_30px_rgba(0,0,0,0.35)] pointer-events-auto"
              style={{ WebkitBackdropFilter: "blur(10px)" }}
            >
              <div className="h-full px-6 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: "rgba(0,196,140,0.15)",
                    border: "1px solid rgba(0,196,140,0.3)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/logo.png"
                    alt="KoryFi"
                    className="w-5 h-5 object-contain"
                    style={{
                      filter:
                        "invert(62%) sepia(60%) saturate(500%) hue-rotate(120deg) brightness(1.1)",
                    }}
                  />
                </div>
                <span className="text-xl font-semibold font-display" style={{ color: "#E6F2ED" }}>
                  KoryFi
                </span>
              </Link>
              <HeaderNav />
              </div>
            </div>
          </header>
          <main className="relative z-10 container mx-auto px-4 pt-28 pb-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
