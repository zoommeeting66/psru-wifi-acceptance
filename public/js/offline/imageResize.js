export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.8;

export function targetSize(width, height, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** ย่อรูปในเครื่องก่อนเข้าคิว เพื่อไม่ให้ IndexedDB บวมจนเบราว์เซอร์ล้างข้อมูลทิ้ง */
export async function shrinkImage(file, maxEdge = MAX_EDGE, quality = JPEG_QUALITY) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality));
}
