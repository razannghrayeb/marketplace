/** Metdata stored on wardrobe_items and sent to POST/PATCH /api/wardrobe/items */

export type WardrobeAudienceGender = 'men' | 'women' | 'unisex'

export type WardrobeAgeGroup = 'kids' | 'adult'

export interface WardrobeItemDto {
  id: number
  name?: string
  category?: string
  color?: string
  image_url?: string
  image_cdn?: string
  audience_gender?: string | null
  age_group?: string | null
  style_tags?: string[] | null
  occasion_tags?: string[] | null
  season_tags?: string[] | null
}

export interface WardrobeItemMetaForm {
  audience_gender: '' | WardrobeAudienceGender
  age_group: '' | WardrobeAgeGroup
  style_tags_csv: string
  occasion_tags_csv: string
  season_tags_csv: string
}

export const emptyWardrobeMetaForm = (): WardrobeItemMetaForm => ({
  audience_gender: '',
  age_group: '',
  style_tags_csv: '',
  occasion_tags_csv: '',
  season_tags_csv: '',
})

/** Tags as comma / semicolon / newline-separated */
export function wardrobeTagsFromCsv(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function wardrobeMetaFormFromItem(item: Partial<WardrobeItemDto> | null): WardrobeItemMetaForm {
  if (!item) return emptyWardrobeMetaForm()
  return {
    audience_gender: (item.audience_gender as WardrobeItemMetaForm['audience_gender']) || '',
    age_group: (item.age_group as WardrobeItemMetaForm['age_group']) || '',
    style_tags_csv: (item.style_tags ?? []).join(', '),
    occasion_tags_csv: (item.occasion_tags ?? []).join(', '),
    season_tags_csv: (item.season_tags ?? []).join(', '),
  }
}

/** Multipart: arrays must be JSON strings */
export function appendWardrobeItemMultipartFields(formData: FormData, meta: WardrobeItemMetaForm) {
  if (meta.audience_gender) formData.append('audience_gender', meta.audience_gender)
  if (meta.age_group) formData.append('age_group', meta.age_group)
  const styles = wardrobeTagsFromCsv(meta.style_tags_csv)
  const occasions = wardrobeTagsFromCsv(meta.occasion_tags_csv)
  const seasons = wardrobeTagsFromCsv(meta.season_tags_csv)
  if (styles.length) formData.append('style_tags', JSON.stringify(styles))
  if (occasions.length) formData.append('occasion_tags', JSON.stringify(occasions))
  if (seasons.length) formData.append('season_tags', JSON.stringify(seasons))
}

export function patchBodyFromMetaForm(meta: WardrobeItemMetaForm): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  body.audience_gender = meta.audience_gender ? meta.audience_gender : null
  body.age_group = meta.age_group ? meta.age_group : null
  body.style_tags = wardrobeTagsFromCsv(meta.style_tags_csv)
  body.occasion_tags = wardrobeTagsFromCsv(meta.occasion_tags_csv)
  body.season_tags = wardrobeTagsFromCsv(meta.season_tags_csv)
  return body
}
