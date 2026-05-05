/**
 * Downscale large outfit photos before Shop-the-look upload so the request
 * is smaller and the API can respond faster (less bytes + decode work).
 */
const DEFAULT_MAX_EDGE = 1400
const JPEG_QUALITY = 0.82

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}

export async function compressImageForShopUpload(
  file: File,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<File> {
  if (!file.type.startsWith('image/') || typeof document === 'undefined') {
    return file
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const { naturalWidth: w, naturalHeight: h } = img
    if (!w || !h) return file

    const longest = Math.max(w, h)
    if (longest <= maxEdge && file.size < 600_000) {
      return file
    }

    const scale = longest > maxEdge ? maxEdge / longest : 1
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, cw, ch)

    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob || blob.size > file.size * 0.98) {
      return file
    }

    const base = file.name.replace(/\.[^.]+$/, '') || 'outfit'
    return new File([blob], `${base}-shop.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
