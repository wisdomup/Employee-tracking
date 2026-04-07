import React, { useRef, useState, useEffect, useCallback } from 'react';
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
  /** No gallery / file picker — only the in-app camera flow. */
  cameraOnly?: boolean;
  /** Passed to getUserMedia; default back camera for shop-style shots. */
  preferredFacingMode?: 'environment' | 'user';
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  value,
  onChange,
  category,
  label = 'Image',
  cameraOnly = false,
  preferredFacingMode = 'environment',
}) => {
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** Bumped when a MediaStream is ready so video srcObject attaches after getUserMedia resolves. */
  const [streamAttachKey, setStreamAttachKey] = useState(0);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const previewUrl = value
    ? value.startsWith('http')
      ? value
      : `${API_BASE}/api${value.startsWith('/') ? '' : '/'}${value}`
    : '';

  useEffect(() => {
    if (cameraOnly || !pickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [cameraOnly, pickerOpen]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || streamAttachKey === 0) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      /* autoplay policies; playsInline usually enough on mobile */
    });
    return () => {
      video.srcObject = null;
    };
  }, [cameraOpen, streamAttachKey]);

  const uploadFile = async (file: File) => {
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
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = '';
  };

  const handleSourceSelect = (source: 'gallery' | 'camera') => {
    setPickerOpen(false);
    if (source === 'gallery') {
      galleryInputRef.current?.click();
    } else {
      void openCamera();
    }
  };

  const openCamera = useCallback(async () => {
    setCameraError(null);
    stopStream();
    streamRef.current = null;
    setStreamAttachKey(0);
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: preferredFacingMode } },
        audio: false,
      });
      streamRef.current = stream;
      setStreamAttachKey((k) => k + 1);
    } catch {
      setCameraError('Could not access camera. Please check browser permissions.');
    }
  }, [preferredFacingMode, stopStream]);

  const closeCamera = () => {
    stopStream();
    streamRef.current = null;
    setStreamAttachKey(0);
    setCameraOpen(false);
    setCameraError(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast.error('Failed to capture photo');
        return;
      }
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      closeCamera();
      await uploadFile(file);
    }, 'image/jpeg', 0.92);
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
        <div className={styles.actions} ref={cameraOnly ? undefined : pickerRef}>
          {cameraOnly ? (
            <button
              type="button"
              onClick={() => {
                void openCamera();
              }}
              disabled={uploading}
              className={styles.uploadButton}
            >
              {uploading ? 'Uploading...' : previewUrl ? 'Retake photo' : 'Take photo'}
            </button>
          ) : (
            <>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                disabled={uploading}
                className={styles.fileInput}
              />
              <button
                type="button"
                onClick={() => setPickerOpen((prev) => !prev)}
                disabled={uploading}
                className={styles.uploadButton}
              >
                {uploading ? 'Uploading...' : previewUrl ? 'Change image' : 'Upload image'}
              </button>
              {pickerOpen && (
                <div className={styles.sourcePicker}>
                  <button
                    type="button"
                    className={styles.sourceOption}
                    onClick={() => handleSourceSelect('gallery')}
                  >
                    <span className={styles.sourceIcon}>🖼️</span>
                    Open Gallery
                  </button>
                  <button
                    type="button"
                    className={styles.sourceOption}
                    onClick={() => handleSourceSelect('camera')}
                  >
                    <span className={styles.sourceIcon}>📷</span>
                    Open Camera
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {cameraOpen && (
        <div className={styles.cameraOverlay}>
          <div className={styles.cameraModal}>
            <div className={styles.cameraHeader}>
              <span className={styles.cameraTitle}>Take a Photo</span>
              <button type="button" className={styles.cameraClose} onClick={closeCamera}>
                ✕
              </button>
            </div>
            <div className={styles.cameraBody}>
              {cameraError ? (
                <div className={styles.cameraError}>
                  <span>⚠️</span>
                  <p>{cameraError}</p>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={styles.cameraVideo}
                />
              )}
              <canvas ref={canvasRef} className={styles.cameraCanvas} />
            </div>
            {!cameraError && (
              <div className={styles.cameraFooter}>
                <button type="button" className={styles.captureButton} onClick={capturePhoto}>
                  📸 Capture
                </button>
                <button type="button" className={styles.cancelCameraButton} onClick={closeCamera}>
                  Cancel
                </button>
              </div>
            )}
            {cameraError && (
              <div className={styles.cameraFooter}>
                <button type="button" className={styles.cancelCameraButton} onClick={closeCamera}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
