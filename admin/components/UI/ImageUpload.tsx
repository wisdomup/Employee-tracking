import React, { useRef, useState } from 'react';
import { uploadImage } from '../../services/uploadService';
import { toast } from 'react-toastify';
import styles from './ImageUpload.module.scss';

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
  : '';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  category: string;
  label?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  value,
  onChange,
  category,
  label = 'Image',
}) => {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const previewUrl = value
    ? value.startsWith('http')
      ? value
      : `${API_BASE}/api${value.startsWith('/') ? '' : '/'}${value}`
    : '';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5MB or smaller');
      return;
    }
    setUploading(true);
    try {
      const url = await uploadImage(file, category);
      onChange(url);
      toast.success('Image uploaded');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : null;
      toast.error(message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className={styles.wrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <div className={styles.uploadArea}>
        {previewUrl && (
          <div className={styles.preview}>
            <img src={previewUrl} alt="Preview" className={styles.previewImg} />
          </div>
        )}
        <div className={styles.actions}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={uploading}
            className={styles.fileInput}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={styles.uploadButton}
          >
            {uploading ? 'Uploading...' : previewUrl ? 'Change image' : 'Upload image'}
          </button>
        </div>
      </div>
    </div>
  );
};
