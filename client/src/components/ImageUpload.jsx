import { useState, useRef } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { uploadImage } from '../lib/storage';

const MAX_BYTES = 5 * 1024 * 1024;

const T = {
  add: '\u0627\u0641\u0632\u0648\u062F\u0646 \u062A\u0635\u0648\u06CC\u0631',
  hint: '\u062D\u062F\u0627\u06A9\u062B\u0631 \u06F5 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A',
  uploading: '\u062F\u0631 \u062D\u0627\u0644 \u0622\u067E\u0644\u0648\u062F...',
  remove: '\u062D\u0630\u0641 \u062A\u0635\u0648\u06CC\u0631',
  failed: '\u0622\u067E\u0644\u0648\u062F \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F',
  onlyImage: '\u0641\u0642\u0637 \u0641\u0627\u06CC\u0644 \u062A\u0635\u0648\u06CC\u0631 \u0645\u062C\u0627\u0632 \u0627\u0633\u062A',
  tooBig: '\u062D\u062C\u0645 \u0641\u0627\u06CC\u0644 \u0628\u06CC\u0634 \u0627\u0632 \u06F5 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A \u0627\u0633\u062A',
};

export default function ImageUpload({ value, onChange, folder = 'products' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError(T.onlyImage); return; }
    if (file.size > MAX_BYTES) { setError(T.tooBig); return; }
    setUploading(true);
    try {
      const url = await uploadImage(file, folder);
      onChange(url);
    } catch (err) {
      console.error(err);
      setError(T.failed);
    } finally {
      setUploading(false);
    }
  };

  const openPicker = () => { if (inputRef.current) inputRef.current.click(); };

  return (
    <div className="w-full">
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      {value ? (
        <div className="relative">
          <img src={value} alt="" className="w-full h-40 object-cover rounded-xl border border-slate-200" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
            aria-label={T.remove}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          className="w-full h-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-primary-600 hover:text-primary-600 transition-colors disabled:opacity-60"
        >
          {uploading ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">{T.uploading}</span>
            </>
          ) : (
            <>
              <Plus className="w-6 h-6" />
              <span className="text-xs font-medium">{T.add}</span>
              <span className="text-[10px] text-slate-300">{T.hint}</span>
            </>
          )}
        </button>
      )}
      {error ? <p className="text-xs text-danger-600 mt-1.5">{error}</p> : null}
    </div>
  );
}
