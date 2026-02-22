import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TourCarousel } from "@/components/TourCarousel";
import { TourLink } from "@/components/TourLink";

export default function HomePage() {
  return (
    <>
      {/* Lock scroll on this page only */}
      <style>{`html, body { overflow: hidden; }`}</style>

      {/*
        Height: 100vh minus header (4rem) minus main top padding only (2rem).
        -mb-8 pulls the div down to cover main's bottom padding so the card
        reaches the very bottom of the viewport.
      */}
      <div className="max-w-6xl mx-auto h-[calc(100vh-6rem)] -mb-8 overflow-hidden flex flex-col">
        <section className="pt-[clamp(0.25rem,1.5vh,1rem)] shrink-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-28 items-start">
            <div className="lg:justify-self-start lg:pr-8">
              <h1
                className="text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.1] tracking-tight text-foreground"
              >
                <span className="block md:whitespace-nowrap">One-click invest in</span>
                <span className="block md:whitespace-nowrap">crypto indices</span>
              </h1>

              <div className="mt-7 flex flex-col sm:flex-row sm:items-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="h-10 px-5 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_0_1px_rgba(0,196,140,0.35)]"
                >
                  <Link href="/baskets">Invest in 28 seconds</Link>
                </Button>

                <TourLink />
              </div>
            </div>

          <div className="lg:justify-self-end lg:self-start lg:pl-8">
            <p className="text-[20px] leading-snug">
              <span className="block text-foreground/70">KoryFi let&apos;s you build your ideal</span>
              <span className="block text-foreground/70">crypto portfolio in one click with</span>
              <span className="block text-[20px] leading-snug mt-1">
                <span className="relative inline-flex items-center group">
                  <span className="underline decoration-1 underline-offset-4 decoration-primary/70 text-primary cursor-help">self-custodial</span>
                  <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-primary/30 bg-card px-3 py-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    Assets go straight to your wallet.{" "}
                    <span className="font-bold text-white">Your keys, your coins.</span>
                  </span>
                </span>{" "}
                <span className="text-foreground">funds</span>
              </span>
              </p>
              <p className="text-[24px] text-foreground leading-snug mt-5">
                Crypto isn&apos;t easy, <span className="text-primary">KoryFi</span> is.
              </p>
            </div>
          </div>
        </section>

        <section id="tour" className="mt-[clamp(1.25rem,5vh,5rem)] flex-1 min-h-0">
          <div className="relative h-full w-auto max-w-full mx-auto aspect-[2/1] overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-primary/20 bg-card shadow-[0_0_0_1px_rgba(0,196,140,0.08)]">
            <TourCarousel />
          </div>
        </section>
      </div>
    </>
  );
}
