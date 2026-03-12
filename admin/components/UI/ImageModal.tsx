import React, { useState } from 'react';
import styles from './ImageModal.module.scss';

interface ImageModalProps {
  images: Array<{ type: string; url: string }>;
  isOpen: boolean;
  onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ images, isOpen, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!isOpen || images.length === 0) return null;

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={handleBackdropClick}>
      <div className={styles.modalContent}>
        <button className={styles.closeButton} onClick={onClose}>
          &times;
        </button>

        <div className={styles.imageContainer}>
          <img
            src={images[currentIndex].url}
            alt={images[currentIndex].type}
            className={styles.image}
          />
          <div className={styles.imageType}>{images[currentIndex].type}</div>
        </div>

        {images.length > 1 && (
          <div className={styles.navigation}>
            <button className={styles.navButton} onClick={handlePrevious}>
              &#8249;
            </button>
            <span className={styles.counter}>
              {currentIndex + 1} / {images.length}
            </span>
            <button className={styles.navButton} onClick={handleNext}>
              &#8250;
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageModal;
