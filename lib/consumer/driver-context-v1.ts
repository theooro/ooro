import { z } from "zod";

export const DRIVER_CONTEXT_API_VERSION = "v1" as const;
export const driverContextRequestV1 = z.object({
  version: z.literal(DRIVER_CONTEXT_API_VERSION),
  permissionGranted: z.literal(true),
  purpose: z.enum(["PICKUP_CONTEXT", "DROPOFF_CONTEXT", "CURRENT_LOCATION"]),
  expiresAt: z.string().datetime(),
  context: z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    pickupLabel: z.string().trim().max(160).optional(),
    dropoffLabel: z.string().trim().max(160).optional(),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const hasLatitude = value.context.latitude !== undefined;
  const hasLongitude = value.context.longitude !== undefined;
  if (hasLatitude !== hasLongitude) ctx.addIssue({ code: "custom", message: "Coordinates must include latitude and longitude together." });
  if (!hasLatitude && !value.context.pickupLabel && !value.context.dropoffLabel) ctx.addIssue({ code: "custom", message: "At least one consented location context is required." });
});

export type DriverContextRequestV1 = z.infer<typeof driverContextRequestV1>;
export type DriverContextShareState = "STOPPED" | "SHARING";
export interface DriverContextProviderV1 {
  readonly version: typeof DRIVER_CONTEXT_API_VERSION;
  requestConsent(): Promise<boolean>;
  startSharing(request: Omit<DriverContextRequestV1, "version" | "permissionGranted">): Promise<void>;
  stopSharing(): Promise<void>;
  getShareState(): DriverContextShareState;
}

/** Consent-gated adapter boundary; no OS or third-party provider integration is implied. */
export class ConsentGatedDriverContextV1 implements DriverContextProviderV1 {
  readonly version = DRIVER_CONTEXT_API_VERSION;
  private state: DriverContextShareState = "STOPPED";
  constructor(private readonly obtainConsent: () => Promise<boolean>, private readonly publish: (value: DriverContextRequestV1) => Promise<void>, private readonly revoke: () => Promise<void>, private readonly now: () => Date = () => new Date()) {}
  async requestConsent() { return this.obtainConsent(); }
  async startSharing(request: Omit<DriverContextRequestV1, "version" | "permissionGranted">) {
    const parsed = driverContextRequestV1.parse({ ...request, version: DRIVER_CONTEXT_API_VERSION, permissionGranted: true });
    if (Date.parse(parsed.expiresAt) <= this.now().getTime()) throw new Error("DRIVER_CONTEXT_EXPIRED");
    if (!await this.obtainConsent()) throw new Error("DRIVER_CONTEXT_CONSENT_REQUIRED");
    await this.publish(parsed);
    this.state = "SHARING";
  }
  async stopSharing() { await this.revoke(); this.state = "STOPPED"; }
  getShareState() { return this.state; }
}
