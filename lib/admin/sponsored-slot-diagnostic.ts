export type SponsoredSlotDiagnostic = { code: string; message: string };

export function sponsoredSlotDiagnosticText(diagnostic?: SponsoredSlotDiagnostic | null): string {
  if (!diagnostic) return 'Sponsored slot status has not been evaluated.';
  return `${diagnostic.code.replaceAll('_', ' ')}: ${diagnostic.message}`;
}
