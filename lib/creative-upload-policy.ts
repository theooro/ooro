export const CREATIVE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const CREATIVE_UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"] as const;

export function validateCreativeUploadInput(input: { mimeType: string; size: number; fileName: string }) {
  if (!CREATIVE_UPLOAD_MIME_TYPES.includes(input.mimeType as typeof CREATIVE_UPLOAD_MIME_TYPES[number])) return { valid: false as const, code: "CREATIVE_TYPE_UNSUPPORTED", message: "Use JPG, PNG, WebP, MP4 or WebM." };
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > CREATIVE_UPLOAD_MAX_BYTES) return { valid: false as const, code: "CREATIVE_SIZE_INVALID", message: "Creative files must be 100 MB or smaller." };
  const fileName = input.fileName.replace(/[\\/\0]/g, "_").trim().slice(-120);
  if (!fileName) return { valid: false as const, code: "CREATIVE_FILENAME_INVALID", message: "The file must have a valid name." };
  return { valid: true as const, fileName };
}
