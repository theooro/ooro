import { NextResponse } from "next/server";
import { webContext } from "@/lib/web-owner";

// Public campaign uploads attached files directly to campaigns. Portal users
// must submit standalone assets for review; only the admin campaign workflow
// can attach an approved creative as part of separate scheduling work.
export async function POST() {
  const context = await webContext();
  if (!context) return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sign in before submitting a creative." } }, { status: 401 });
  return NextResponse.json({ error: { code: "CREATIVE_SUBMISSION_REQUIRED", message: "Submit creatives from the Creative portal for review. Campaign attachment and scheduling are separate workflows." } }, { status: 403 });
}
