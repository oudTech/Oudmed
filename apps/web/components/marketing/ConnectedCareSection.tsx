"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { AnimatePresence, m } from "framer-motion";
import { Reveal } from "@/components/motion/Reveal";

// GSAP/ScrollTrigger is only needed once the user scrolls this far down the
// page - code-split into its own chunk so it's not part of the initial bundle
// for everything above the fold. SSR stays on (the default): the component's
// own window/GSAP access is safely inside a useEffect that never runs during
// SSR anyway, so there's no need to sacrifice server-rendered markup for it -
// this way the section still has real content on first paint, no pop-in.
const PinnedScrollSection = dynamic(() =>
  import("@/components/motion/PinnedScrollSection").then((mod) => mod.PinnedScrollSection),
);

interface Tab {
  id: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
}

// Only "Virtual Front Door" is the design's own copy. The Figma's fifth tab
// claimed AWS hosting specifically - our real infrastructure is Fly.io/Render/
// Neon, not AWS, so that claim would be false; renamed to what is actually
// true (Postgres Row-Level Security tenant isolation, HTTPS everywhere).
const TABS: Tab[] = [
  {
    id: "front-door",
    label: "Virtual Front Door",
    title: "Virtual Front Door",
    description:
      "Modernize your patient experience for faster, easier admin, handling everything from appointments to bill pay.",
    bullets: [
      "Integrated text to web scheduling",
      "Automated, actionable reminders in 33+ languages",
      "Seamless cancel management",
    ],
  },
  {
    id: "population-health",
    label: "Population Health",
    title: "Population Health",
    description:
      "See how your patients are doing at a glance, not just one chart at a time.",
    bullets: [
      "Cross-ward patient trend reporting",
      "Chronic-condition follow-up tracking",
      "Department-level outcome dashboards",
    ],
  },
  {
    id: "mobile-ehr",
    label: "Mobile EHR",
    title: "Mobile EHR",
    description:
      "The same records and workflows your staff use at a desk, wherever they actually are in the building.",
    bullets: [
      "Access patient charts from any device",
      "Real-time chart updates across staff",
      "Works on tablets at the bedside",
    ],
  },
  {
    id: "connected-data",
    label: "Connected Data",
    title: "Connected Data",
    description:
      "One patient record moves with them through every department, instead of living in five different systems.",
    bullets: [
      "One patient record across every module",
      "No duplicate data entry between departments",
      "Instant handoff from reception to pharmacy to billing",
    ],
  },
  {
    id: "secure-hosting",
    label: "Secure Cloud Hosting",
    title: "Secure Cloud Hosting",
    description:
      "Every hospital’s data is isolated at the database level, not just by application logic.",
    bullets: [
      "HTTPS everywhere, end to end",
      "Postgres Row-Level Security isolates every hospital's data",
      "Encrypted file storage",
    ],
  },
];

export function ConnectedCareSection() {
  const [active, setActive] = useState(0);
  const tab = TABS[active];

  return (
    <PinnedScrollSection steps={TABS.length} onStepChange={setActive}>
      <section className="bg-[#3366E3] rounded-3xl mx-4 sm:mx-6 lg:mx-auto lg:max-w-6xl px-6 py-16 sm:py-20 text-white">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold">
              Next-level connected care
            </h2>
            <p className="text-white mt-3">
              Connect with patients wherever you go, with secure data management and
              real-time engagement that keeps your practice on the move.
            </p>
          </div>
        </Reveal>

        <div className="flex flex-wrap justify-center gap-3 mt-8">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setActive(i)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                i === active
                  ? "bg-white text-primary border-white"
                  : "border-white/40 text-white hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center mt-12">
          <div className="relative">
            <Image
              src="/next-level.png"
              alt="Doctor reviewing a patient's chart on a tablet"
              width={800}
              height={600}
              className="rounded-2xl aspect-[4/3] w-full object-cover"
            />
            <AnimatePresence mode="wait">
              <m.div
                key={tab.id}
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="absolute left-4 bottom-4 sm:-left-6 sm:bottom-8 bg-white text-gray-900 rounded-xl shadow-xl p-4 max-w-[220px]"
              >
                <p className="text-sm leading-snug">
                  Your Appointment is scheduled for Monday, May 6 at 1:30pm with Dr.
                  Phillips.
                </p>
                <p className="text-xs text-primary font-semibold mt-3">
                  Tap to Confirm Appointment
                </p>
              </m.div>
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait">
            <m.div
              key={tab.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <h3 className="text-xl font-bold">{tab.title}</h3>
              <p className="text-white mt-3">{tab.description}</p>
              <ul className="mt-4 space-y-2">
                {tab.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-white">
                    <span className="w-1.5 h-1.5 rounded-sm bg-white/60 mt-1.5 flex-shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </m.div>
          </AnimatePresence>
        </div>
      </section>
    </PinnedScrollSection>
  );
}
