import test from "node:test";
import assert from "node:assert/strict";
import { CREATIVE_UPLOAD_MAX_BYTES, validateCreativeUploadInput } from "./creative-upload-policy";

test("creative upload input accepts supported files and sanitizes names", () => {
  assert.deepEqual(validateCreativeUploadInput({ mimeType: "image/png", size: 10, fileName: "../brand.png" }), { valid: true, fileName: ".._brand.png" });
  assert.equal(validateCreativeUploadInput({ mimeType: "video/mp4", size: CREATIVE_UPLOAD_MAX_BYTES, fileName: "spot.mp4" }).valid, true);
});

test("creative upload input rejects unsupported types, empty files, and oversize files", () => {
  assert.equal(validateCreativeUploadInput({ mimeType: "application/pdf", size: 20, fileName: "ad.pdf" }).code, "CREATIVE_TYPE_UNSUPPORTED");
  assert.equal(validateCreativeUploadInput({ mimeType: "image/png", size: 0, fileName: "ad.png" }).code, "CREATIVE_SIZE_INVALID");
  assert.equal(validateCreativeUploadInput({ mimeType: "image/png", size: CREATIVE_UPLOAD_MAX_BYTES + 1, fileName: "ad.png" }).code, "CREATIVE_SIZE_INVALID");
  assert.equal(validateCreativeUploadInput({ mimeType: "image/png", size: 10, fileName: "  " }).code, "CREATIVE_FILENAME_INVALID");
});
