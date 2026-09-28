"use client";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { subscriptionsApi } from "@/lib/subscriptions";
import { naira } from "@/lib/billing";
import { Reveal } from "@/components/motion/Reveal";
import { useAnimatedNumber } from "@/components/motion/hooks";

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.2196 20.1966L5.98361 14.9606L4.23828 16.706L11.2196 23.6873L26.1796 8.72727L24.4343 6.98193L11.2196 20.1966Z"
        fill="#1C6D15"
      />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.48438 7.48022L14.9644 14.9602M14.9644 14.9602L22.4444 22.4402M14.9644 14.9602L22.4444 7.48022M14.9644 14.9602L7.48438 22.4402"
        stroke="#9F1C21"
        strokeWidth="2.49333"
        strokeLinecap="round"
      />
    </svg>
  );
}

const COMPARISON = [
  "Free training and onboarding",
  "Predictable payments",
  "On-site support",
  "Unlimited patient records",
  "Unlimited file storage",
  "No fees on your patient charges",
  "No sudden EMR access restrictions",
];

export function PricingCalculator() {
  const [users, setUsers] = useState(1);
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const pricing = useQuery({
    queryKey: ["public-pricing"],
    queryFn: subscriptionsApi.getPricing,
  });

  const adminSeat = Number(pricing.data?.adminSeatPriceMonthly ?? 0);
  const otherSeat = Number(pricing.data?.otherSeatPriceMonthly ?? 0);
  const discountPct = Number(pricing.data?.annualDiscountPct ?? 0);
  const userPercent = ((users - 1) / (100 - 1)) * 100;
  const otherSeats = Math.max(0, users - 1);
  const monthlyTotal = adminSeat + otherSeats * otherSeat;
  const annualListTotal = monthlyTotal * 12;
  const annualDiscountedTotal = annualListTotal * (1 - discountPct / 100);
  const displayedTotal =
    cycle === "ANNUAL" ? annualDiscountedTotal : monthlyTotal;
  const priceSuffix = cycle === "ANNUAL" ? "/y" : "/m";
  const animatedTotal = useAnimatedNumber(displayedTotal);

  return (
    <section className="max-w-6xl mx-auto px-6 py-16 sm:py-24">
      <Reveal>
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
          Compare plans to choose the right one for your clinic
        </h2>
        <p className="text-gray-500 mt-4 max-w-3xl">
          Oudmed is excellent for clinics and hospitals with varying team sizes.
          As we operate on a SaaS model, it offers clear pricing plans for health
          facilities of all sizes with affordable rates based on the number of
          users. You can use the cost calculator below or request custom pricing
          for hospitals with 100+ users, and our representative will contact you
          within 24 hours.
        </p>
      </Reveal>

      <div className="mt-10 rounded-3xl bg-gray-50 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
        <Reveal
          direction="left"
          className="p-6 sm:p-8 text-white flex flex-col"
          style={{
            background: "linear-gradient(180deg, #0A172D 0%, #3366E3 100%)",
          }}
        >
          <div>
            <h3 className="text-lg sm:text-xl leading-[35.9px] font-bold">
              One plan to fit clinics of all sizes
            </h3>
            <p className="text-white text-sm leading-[26.18px] font-light mt-3">
              Simple, flexible pricing. Pay monthly or annually with no extra
              cost.
            </p>

            {/* One continuous bar - Monthly/Annually on the left, the Save
                badge on the right, not two separate pills. */}
            <div className="mt-4 flex items-center justify-between gap-2 bg-white/10 rounded-full px-1.5 py-1">
              <div className="flex items-center gap-2 pl-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setCycle("MONTHLY")}
                  className={`text-sm font-semibold transition ${cycle === "MONTHLY" ? "text-white" : "text-white/60"}`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCycle(cycle === "MONTHLY" ? "ANNUAL" : "MONTHLY")
                  }
                  aria-label="Toggle billing cycle"
                  className="w-9 h-5 rounded-full bg-white flex items-center px-0.5 transition flex-shrink-0"
                >
                  <span
                    className={`w-4 h-4 rounded-full bg-[#3366E3] transition-transform ${cycle === "ANNUAL" ? "translate-x-4" : "translate-x-0"}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setCycle("ANNUAL")}
                  className={`text-sm font-semibold transition ${cycle === "ANNUAL" ? "text-white" : "text-white/60"}`}
                >
                  Annually
                </button>
              </div>
              {discountPct > 0 && (
                <span className="bg-white text-[#3366E3] text-xs sm:text-base font-bold rounded-full px-2 py-1 whitespace-nowrap flex-shrink-0">
                  Save{" "}
                  {discountPct % 1 === 0 ? discountPct : discountPct.toFixed(1)}
                  % yearly
                </span>
              )}
            </div>

            <p className="mt-4 text-2xl sm:text-5xl font-semiBold">
              {users} user{users === 1 ? "" : "s"}
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-2 text-xs text-white font-semibold font-inter mb-1.5">
                <span>
                  {otherSeat
                    ? `Users: ${naira(otherSeat)}x${otherSeats} = ${naira(otherSeat * otherSeats)}/m`
                    : ""}
                </span>
                <span>
                  {adminSeat ? `1 admin user = ${naira(adminSeat)}/m` : ""}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={users}
                onChange={(e) => setUsers(Number(e.target.value))}
                style={{
                  background: `linear-gradient(to right, #FFFFFF ${userPercent}%, #FFFFFF26 ${userPercent}%)`,
                }}
                className="w-full h-1.5 appearance-none cursor-pointer rounded-full
                  [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                  [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent
                  [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
              />
              <div className="flex items-center justify-between text-xs text-white/80 font-inter font-medium mt-1">
                <span>1</span>
                <span>100+</span>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2.5 flex-wrap">
              <span className="rounded-xl overflow-hidden flex items-stretch flex-shrink-0">
                <span className="bg-white/25 px-3 py-4 flex items-center justify-center">
                  <svg
                    width="32"
                    height="41"
                    viewBox="0 0 32 41"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M3.75025 40.5537V26.2974H0.00157505V22.3215H3.75025V18.0049H0.00157505V14.029H3.75025V-0.000153811H11.5316L16.3026 14.029H22.0392V-0.000153811H27.6623V14.029H31.3541V18.0049H27.6623V22.3215H31.3541V26.2974H27.6623V40.5537H19.8241L14.9395 26.2974H9.31647V40.5537H3.75025ZM9.31647 22.3215H13.6899L12.27 18.0049H9.20287L9.31647 22.3215ZM22.1528 32.034H22.4368L22.2096 26.2974H20.3353L22.1528 32.034ZM9.14607 14.029H11.0204L9.08928 7.95159H8.86208L9.14607 14.029ZM19.0857 22.3215H22.1528L22.0392 18.0049H17.6658L19.0857 22.3215Z"
                      fill="white"
                    />
                  </svg>
                </span>
                <span className="bg-white/10 px-1 py-4 flex items-center justify-center">
                  <svg
                    width="15"
                    height="10"
                    viewBox="0 0 15 10"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M1.7578 0L7.48 5.70968L13.2022 0L14.96 1.7578L7.48 9.23775L0 1.7578L1.7578 0Z"
                      fill="white"
                    />
                  </svg>
                </span>
              </span>
              {cycle === "ANNUAL" && discountPct > 0 && pricing.data && (
                <span className="text-white/50 text-base sm:text-2xl font-semibold line-through tabular-nums">
                  {Math.round(annualListTotal).toLocaleString()}
                </span>
              )}
              <span className="text-2xl sm:text-6xl font-bold tabular-nums">
                {pricing.data
                  ? Math.round(animatedTotal).toLocaleString()
                  : "..."}
              </span>
              <span className="text-white text-sm sm:text-6xl font-semibold">
                {priceSuffix}
              </span>
            </div>
            <p className="text-white font-light text-base mt-3">
              {cycle === "ANNUAL"
                ? "Billed once a year after the 14-day trial period"
                : "Billed monthly after the 14-day trial period"}
            </p>
          </div>

          <a
            href="/signup"
            className="inline-block mt-auto rounded-full bg-white text-[#0C1754] px-5 py-2.5 text-sm font-bold hover:bg-gray-50 transition self-start"
          >
            START FOR FREE NOW
          </a>
        </Reveal>

        <Reveal direction="right" className="bg-white p-6 sm:p-8">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 leading-snug">
            Simple pricing that scales with your users not your revenue or
            records.
          </h3>
          <p className="text-gray-500 text-sm mt-2">
            With Oudmed, pricing is simple and transparent. Your cost depends
            only on the number of users in your clinic.
          </p>

          <div className="mt-4 grid grid-cols-[1fr,auto,auto] items-center gap-x-4">
            <span />
            <span className="font-semibold text-gray-900 text-center text-sm pb-1.5">
              Oudmed
            </span>
            <span className="font-semibold text-gray-400 text-center text-sm pb-1.5">
              Other EMRs
            </span>
            {COMPARISON.map((row) => (
              <Fragment key={row}>
                <span className="col-span-3 border-t border-[#0000001F]" />
                <span className="text-gray-800 text-sm flex items-center whitespace-nowrap py-2">
                  {row}
                </span>
                <span className="py-2 flex justify-center">
                  <span className="w-[117px] h-[30px] rounded-md bg-[#2BB01F1F] flex items-center justify-center">
                    <CheckIcon />
                  </span>
                </span>
                <span className="py-2 flex justify-center">
                  <span className="w-[117px] h-[30px] rounded-md bg-[#ED1C241F] flex items-center justify-center">
                    <CloseIcon />
                  </span>
                </span>
              </Fragment>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
