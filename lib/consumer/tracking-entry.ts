export type TrackingEntryResult = { status: 302; location: string } | { status: 404 | 502 | 503; message: string };

export async function resolveTrackingEntry(token: string, apiBase: string | null, fetcher: typeof fetch = fetch): Promise<TrackingEntryResult> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return { status: 404, message: "Tracking link not found." };
  if (!apiBase) return { status: 503, message: "Tracking service is unavailable." };
  try {
    const tracked = await fetcher(`${apiBase.replace(/\/$/, "")}/go/${token}`, { redirect: "manual", cache: "no-store", headers: { accept: "text/html" } });
    if (tracked.status !== 302 || !tracked.headers.get("location")) return { status: tracked.status === 404 ? 404 : 502, message: tracked.status === 404 ? "Tracking link not found." : "Tracking service is unavailable." };
    // The upstream Location can only be a redemption destination. Ignore it;
    // consumers always land on OORO first and choose whether to redeem.
    return { status: 302, location: `https://theooro.com/offer/${token}` };
  } catch { return { status: 502, message: "Tracking service is unavailable." }; }
}
