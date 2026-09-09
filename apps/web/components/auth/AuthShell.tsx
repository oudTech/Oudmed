import Image from 'next/image'

/**
 * The split-panel auth layout: brand panel on the left (lg+), form on the right.
 * Matches the Figma login / registration / verification screens.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex font-hanken bg-white">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 px-4 py-6">
        <div
          className="flex-1 flex flex-col relative overflow-hidden rounded-[10px]"
          style={{ background: 'linear-gradient(to bottom, #366CE4, #58A6F0)' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'url(/dotted-frame.png)',
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'cover',
              opacity: 0.1,
            }}
          />
          <div className="relative z-10 flex-shrink-0 px-10 pt-14 pb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/oudmed-logo-white.svg" alt="Oudmed" className="h-7 w-auto mb-10" />
            <h2 className="text-white text-[1.75rem] font-bold leading-snug max-w-md">
              Our (HMS) is a comprehensive healthcare solution designed to streamline hospital
              operations and improve patient care
            </h2>
          </div>
          <div className="relative z-10 flex-1 min-h-0 pl-8 pb-8">
            <div className="relative w-full h-full">
              <Image
                src="/auth-frame.png"
                alt="Oudmed dashboard preview"
                fill
                className="object-cover object-top"
                priority
              />
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white overflow-y-auto px-6 py-10 sm:px-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  )
}
