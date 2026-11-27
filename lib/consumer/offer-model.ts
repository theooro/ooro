export type ConsumerOfferFields = {
  id?: string;
  campaignId?: string;
  creativeId?: string;
  campaignName?: string | null;
  name?: string | null;
  brandName?: string | null;
  brand?: string | null;
  offerTitle?: string | null;
  title?: string | null;
  promotionalText?: string | null;
  offerSubtitle?: string | null;
  offerValue?: string | null;
  ctaLabel?: string | null;
  qrLabel?: string | null;
  qrUrl?: string | null;
  consumerUrl?: string | null;
  state?: string;
};

export type BrandedOffer = {
  id: string;
  campaignId: string | null;
  creativeId: string | null;
  brand: string;
  headline: string;
  supportingText: string | null;
  value: string | null;
  cta: string;
  consumerUrl: string | null;
  state: string;
};

function text(...values: Array<string | null | undefined>): string | null {
  return values.map(value => value?.trim()).find(value => Boolean(value)) ?? null;
}

/** A QR printed by OORO always enters through the canonical public consumer site. */
export function canonicalConsumerQrUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "theooro.com" || url.port || url.username || url.password) return null;
    if (!/^\/go\/[A-Za-z0-9_-]{32}$/.test(url.pathname)) return null;
    return `https://theooro.com${url.pathname}`;
  } catch {
    return null;
  }
}

export function mapBrandedOffer(input: ConsumerOfferFields): BrandedOffer {
  const headline = text(input.offerTitle, input.title, input.promotionalText, input.offerSubtitle) ?? "Find your next favourite";
  const supportingText = [input.promotionalText, input.offerSubtitle]
    .map(value => value?.trim())
    .find(value => Boolean(value) && value !== headline) ?? null;
  const value = text(input.offerValue);
  return {
    id: input.id ?? "preview-offer",
    campaignId: input.campaignId ?? null,
    creativeId: input.creativeId ?? null,
    brand: text(input.brandName, input.brand, input.name) ?? "A local favourite",
    headline,
    supportingText,
    value,
    cta: text(input.ctaLabel, input.qrLabel) ?? (value ? "SCAN TO CLAIM OFFER" : "SCAN TO EXPLORE"),
    consumerUrl: canonicalConsumerQrUrl(input.consumerUrl ?? input.qrUrl),
    state: input.state ?? "ACTIVE",
  };
}

// The generated bitmap includes a four-module quiet zone and the card adds a
// small white inset. Keep the total rendered square >=200 CSS px so the QR
// symbol itself remains close to the 150px scan-safe floor.
export const MIN_CONSUMER_QR_SIZE_PX = 200;

export function offerQrSize(width: number, height: number, reservedTextHeight: number, inset = 24): number {
  return Math.floor(Math.max(0, Math.min(width - inset * 2, height - reservedTextHeight)));
}
