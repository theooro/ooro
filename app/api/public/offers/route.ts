import { publicApi } from "@/lib/consumer/public-api";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET() { return publicApi("/api/public/offers"); }
