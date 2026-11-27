import { ConsumerOfferExperience } from "@/components/consumer/consumer-offer-experience";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConsumerOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConsumerOfferExperience token={token} />;
}
