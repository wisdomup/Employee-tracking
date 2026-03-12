import React from 'react';
import styles from './Loader.module.scss';

interface LoaderProps {
  size?: 'small' | 'medium' | 'large';
}

const Loader: React.FC<LoaderProps> = ({ size = 'medium' }) => {
  return (
    <div className={styles.loaderContainer}>
      <div className={`${styles.loader} ${styles[size]}`}></div>
    </div>
  );
};

export default Loader;
