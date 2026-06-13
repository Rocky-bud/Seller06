// STAGE 31 -- server-side persistence of receipt/product images into the public
// `merchant-files` Supabase Storage bucket. Instagram/Telegram media URLs expire,
// so we download the bytes once and re-host them permanently.
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const BUCKET = 'merchant-files';
const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`;

function extFromContentType(ct) {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}

// Download an image from `sourceUrl` and upload it to merchant-files/<folder>/...
// Returns the permanent public URL. On ANY problem it returns the original URL
// so the calling flow is never broken (best-effort, non-fatal).
export async function persistImageFromUrl(sourceUrl, folder = 'receipts', shopId = 'shop') {
  try {
    if (!sourceUrl || typeof sourceUrl !== 'string') return sourceUrl;
    if (sourceUrl.startsWith('file_id:')) return sourceUrl; // Telegram placeholder, not fetchable
    if (sourceUrl.includes(PUBLIC_PREFIX)) return sourceUrl; // already permanent
    if (!SUPABASE_URL || !SUPABASE_KEY) return sourceUrl;

    const resp = await fetch(sourceUrl);
    if (!resp.ok) {
      console.warn(`[storageService] download failed (${resp.status})`);
      return sourceUrl;
    }
    const contentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (!buffer.length) return sourceUrl;

    const ext = extFromContentType(contentType);
    const rand = Math.random().toString(36).slice(2, 8);
    const safeShop = String(shopId || 'shop').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const objectPath = `${folder}/${safeShop}/${Date.now()}-${rand}.${ext}`;

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'Cache-Control': '3600',
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      console.warn(`[storageService] upload failed (${uploadRes.status}): ${errText.slice(0, 140)}`);
      return sourceUrl;
    }

    return `${SUPABASE_URL}${PUBLIC_PREFIX}${objectPath}`;
  } catch (err) {
    console.error('[storageService] persistImageFromUrl error:', err.message);
    return sourceUrl;
  }
}

// Convenience wrapper for receipt images.
export async function persistReceiptImage(sourceUrl, shopId) {
  return persistImageFromUrl(sourceUrl, 'receipts', shopId);
}
