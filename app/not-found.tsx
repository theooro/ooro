import Link from "next/link";
import { ArrowRight, Compass, MoveUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { BackButton } from "@/components/app/back-button";

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-screen flex-col overflow-hidden bg-[#0b0d0c] text-white selection:bg-[#dfff00] selection:text-black">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_34%,rgba(223,255,0,.11),transparent_42%),linear-gradient(135deg,#0b0d0c_0%,#111615_55%,#090a09_100%)]"/>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-[.12] [background-image:linear-gradient(rgba(255,255,255,.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.1)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"/>
      <header className="flex h-[76px] items-center justify-between border-b border-white/[.08] px-5 sm:px-10">
        <Brand dark/>
        <BackButton fallbackHref="/" className="border-white/15 text-neutral-300 hover:bg-white/[.06] hover:text-white"/>
      </header>
      <section className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-5 py-16 sm:px-10 lg:grid-cols-[1.05fr_.95fr] lg:gap-20">
        <div className="relative">
          <div className="mb-8 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[.24em] text-[#dfff00]"><span className="h-px w-8 bg-[#dfff00]"/>Route unavailable</div>
          <h1 className="max-w-2xl text-6xl font-semibold leading-[.94] tracking-[-.07em] sm:text-8xl">This page<br/><span className="text-[#dfff00]">missed its turn.</span></h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-neutral-400 sm:text-lg">The link may be old, or the address may have a typo. Let’s get you back on the OORO route.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#dfff00] px-5 text-sm font-semibold text-black transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-white">Go to OORO home <ArrowRight size={16}/></Link>
            <Link href="/admin/login" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/15 px-5 text-sm font-medium text-neutral-200 transition hover:border-white/30 hover:bg-white/[.05] focus:outline-none focus:ring-2 focus:ring-[#dfff00]">Admin sign in <MoveUpRight size={15}/></Link>
          </div>
          <p className="mt-7 font-mono text-xs tracking-[.16em] text-neutral-600">ERROR 404 <span className="px-2 text-neutral-700">/</span> NO ROUTE FOUND</p>
        </div>
        <div aria-hidden="true" className="relative mx-auto flex aspect-square w-full max-w-[440px] items-center justify-center">
          <div className="absolute inset-[8%] rounded-full border border-white/[.08]"/><div className="absolute inset-[20%] rounded-full border border-[#dfff00]/20"/><div className="absolute inset-[32%] rounded-full border border-white/[.08]"/>
          <div className="absolute h-px w-[88%] rotate-[-34deg] bg-gradient-to-r from-transparent via-[#dfff00]/40 to-transparent"/><div className="absolute h-px w-[88%] rotate-[34deg] bg-gradient-to-r from-transparent via-white/15 to-transparent"/>
          <div className="relative flex h-36 w-36 items-center justify-center rounded-[36px] border border-[#dfff00]/25 bg-[#dfff00]/[.07] shadow-[0_0_90px_rgba(223,255,0,.13)]"><Compass size={64} strokeWidth={1.1} className="text-[#dfff00]"/><span className="absolute -right-3 -top-3 rounded-full border border-[#dfff00]/30 bg-[#151a12] px-3 py-1.5 font-mono text-xs text-[#dfff00]">404</span></div>
          <span className="absolute left-[8%] top-[22%] h-2 w-2 rounded-full bg-[#dfff00] shadow-[0_0_20px_#dfff00]"/><span className="absolute bottom-[17%] right-[14%] h-1.5 w-1.5 rounded-full bg-white/60"/>
        </div>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] px-5 py-5 text-xs text-neutral-600 sm:px-10"><span>OORO · The operating layer for offline advertising</span><Link href="/" className="text-neutral-400 hover:text-[#dfff00]">Explore OORO <ArrowRight className="ml-1 inline" size={12}/></Link></footer>
    </main>
  );
}
