/**
 * Virtual try-on submissions to the marketplace API.
 * Requires NEXT_PUBLIC_MARKETPLACE_API_URL (e.g. https://xxx.run.app).
 */

function marketplaceOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_MARKETPLACE_API_URL?.trim();
  if (!raw) {
    throw new Error("NEXT_PUBLIC_MARKETPLACE_API_URL is not set");
  }
  return raw.replace(/\/$/, "");
}

export type SubmitTryOnParams = {
  userId: number;
  personImage: Blob;
  garmentImage?: Blob;
  category?: string;
  garmentDescription?: string;
  garmentId?: number;
  garmentSource?: "upload" | "product" | "wardrobe";
};

export async function submitTryOn(params: SubmitTryOnParams): Promise<Response> {
  const base = marketplaceOrigin();
  const uid = String(params.userId);
  const form = new FormData();
  form.append("user_id", uid);
  if (params.category) form.append("category", params.category);
  if (params.garmentDescription) {
    form.append("garment_description", params.garmentDescription);
  }
  if (params.garmentId != null) {
    form.append("garment_id", String(params.garmentId));
    form.append("garment_source", params.garmentSource ?? "product");
  }
  form.append("person_image", params.personImage, "person.jpg");
  if (params.garmentImage) {
    form.append("garment_image", params.garmentImage, "garment.jpg");
  }

  return fetch(`${base}/api/tryon/`, {
    method: "POST",
    headers: { "x-user-id": uid },
    body: form,
  });
}
