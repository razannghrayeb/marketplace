/**
 * Browser helper for POST /api/tryon/ — copy into StyleAI (or any Next/React app).
 * The marketplace API requires a numeric user for quotas and job ownership.
 */

export type SubmitTryOnInput = {
  userId: number;
  personImage: Blob;
  /** Required unless `garmentId` is set */
  garmentImage?: Blob;
  category?: string;
  garmentDescription?: string;
  garmentId?: number;
  garmentSource?: "upload" | "product" | "wardrobe";
};

/**
 * @param marketplaceApiOrigin e.g. https://xxx.run.app (no trailing slash)
 */
export async function submitMarketplaceTryOn(
  marketplaceApiOrigin: string,
  input: SubmitTryOnInput,
): Promise<Response> {
  const base = marketplaceApiOrigin.replace(/\/$/, "");
  const uid = String(input.userId);
  const form = new FormData();
  form.append("user_id", uid);
  if (input.category) form.append("category", input.category);
  if (input.garmentDescription) {
    form.append("garment_description", input.garmentDescription);
  }
  if (input.garmentId != null) {
    form.append("garment_id", String(input.garmentId));
    form.append("garment_source", input.garmentSource ?? "product");
  }
  form.append("person_image", input.personImage, "person.jpg");
  if (input.garmentImage) {
    form.append("garment_image", input.garmentImage, "garment.jpg");
  }

  return fetch(`${base}/api/tryon/`, {
    method: "POST",
    headers: { "x-user-id": uid },
    body: form,
  });
}
