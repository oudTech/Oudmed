"use client";
import Image from "next/image";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { TiltCard } from "@/components/motion/TiltCard";
import { useCursor } from "@/components/motion/CursorProvider";

const CARDS = [
  { headline: "Our clients are making healthcare better.", image: "/real-impact1.png" },
  { headline: "Stay current on the latest healthcare trends", image: "/real-impact2.png" },
  // real-impact3.png was pulled - it visibly showed a real, unrelated
  // healthcare company's logo ("Wilmington Health") on the doctor's lab coat.
  // Reusing real-impact1 here until a clean third photo is available.
  { headline: "People are loving Oudmed healthcare", image: "/real-impact1.png" },
];

export function RealImpactSection() {
  const { setCursorText } = useCursor();

  return (
    <section className="max-w-6xl mx-auto px-6 py-16 sm:py-24">
      <Stagger className="grid grid-cols-1 sm:grid-cols-3 gap-4" stagger={0.1}>
        {CARDS.map((c) => (
          <StaggerItem key={c.headline} distance={30}>
            <TiltCard maxTilt={5} hoverScale={1.03} className="h-full">
              <a
                href="/signup"
                onMouseEnter={() => setCursorText("View")}
                onMouseLeave={() => setCursorText(undefined)}
                className="relative rounded-2xl overflow-hidden aspect-[3/4] flex items-end p-5 h-full"
              >
                <Image src={c.image} alt="" fill className="object-cover" />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(11,27,61,0) 40%, rgba(11,27,61,0.85) 100%)",
                  }}
                />
                <div className="relative z-10">
                  <p className="text-xs text-white">Real Impact</p>
                  <p className="text-white font-semibold mt-4 leading-snug">
                    {c.headline}
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-white text-sm mt-3">
                    Explore Success Stories
                    <span className="w-4 h-4 rounded-full bg-[#3366E3] transition" />
                  </span>
                </div>
              </a>
            </TiltCard>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
