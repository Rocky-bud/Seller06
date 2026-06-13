import { supabase } from './supabaseClient';

export const MERCHANT_FILES_BUCKET = 'merchant-files';

function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : 'jpg';
}

function sanitizeName(name) {
  const base = (name || 'image').replace(/\.[^.]+$/, '');
  return base.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'image';
}

// Uploads an image File/Blob to the public `merchant-files` bucket under
// <folder>/ and returns its permanent public URL via getPublicUrl.
export async function uploadImage(file, folder = 'products') {
  if (!file) throw new Error('No file provided');
  const ext = extOf(file.name);
  const base = sanitizeName(file.name);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${folder}/${Date.now()}-${rand}-${base}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(MERCHANT_FILES_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(MERCHANT_FILES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
