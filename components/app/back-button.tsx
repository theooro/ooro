"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

function parentPath(pathname: string, fallback: string) {
  const clean = pathname.split("?")[0].replace(/\/$/, "");
  if (!clean || clean === "/") return fallback;
  if (clean === "/admin") return "/";
  const segments = clean.split("/").filter(Boolean);
  if (segments.length <= 1) return fallback;
  return `/${segments.slice(0, -1).join("/")}`;
}

export function BackButton({ fallbackHref, className = "" }: { fallbackHref?: string; className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const fallback = fallbackHref ?? parentPath(pathname, "/");

  function goBack() {
    const previous = document.referrer;
    const sameOrigin = (() => { try { return Boolean(previous && new URL(previous).origin === window.location.origin); } catch { return false; } })();
    if (sameOrigin && window.history.length > 1) router.back();
    else router.push(fallback);
  }

  return <button type="button" onClick={goBack} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[#dfff00] ${className}`} aria-label="Go back">
    <ArrowLeft size={14} aria-hidden="true"/> Back
  </button>;
}
