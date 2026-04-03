import React from 'react';
import { toast } from 'react-toastify';
import styles from '../../styles/AuthSplit.module.scss';

const APP_NAME = 'GPS Task Tracker';

/** Shared left-panel copy for all auth screens */
export const AUTH_MARKETING = {
  title: 'One workspace for routes, visits, and field operations',
  subtitle:
    'Track teams on the map, manage orders and tasks, and keep admins and people in the field aligned—from the warehouse to the road.',
} as const;

function LogoMark({ size = 'large' }: { size?: 'large' | 'small' }) {
  const isSmall = size === 'small';
  return (
    <div
      className={`${styles.logoMark} ${isSmall ? styles.logoMarkSmall : ''}`}
      aria-hidden
    >
      <svg
        className={`${styles.logoSvg} ${isSmall ? styles.logoSvgSmall : ''}`}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M16 6C12.134 6 9 9.134 9 13c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="13" r="2.5" fill="#fbbf24" />
      </svg>
    </div>
  );
}

export type AuthSplitLayoutProps = {
  children: React.ReactNode;
  marketingTitle: string;
  marketingSubtitle: string;
  formTitle: string;
  formSubtitle?: string;
  topRight?: React.ReactNode;
  /** Replace default footer (copyright + links). */
  footer?: React.ReactNode;
};

export function AuthSplitLayout({
  children,
  marketingTitle,
  marketingSubtitle,
  formTitle,
  formSubtitle,
  topRight,
  footer,
}: AuthSplitLayoutProps) {
  const defaultFooter = (
    <>
      <span>
        © {new Date().getFullYear()} {APP_NAME}
      </span>
      <div className={styles.footerLinks}>
        <button
          type="button"
          className={styles.footerLink}
          onClick={() =>
            toast.info(
              'How we handle data is set by your organization. Ask your administrator for the privacy policy that applies to you.',
            )
          }
        >
          Privacy
        </button>
        <button
          type="button"
          className={styles.footerLink}
          onClick={() =>
            toast.info('For help signing in or using the app, contact your organization administrator.')
          }
        >
          Support
        </button>
      </div>
    </>
  );

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <aside className={styles.marketing} aria-label="Product overview">
          <div className={styles.marketingLogoWrap}>
          <img src="/logo.jpeg" alt="GPS Task Tracker" className={styles.logoImage} />
          </div>
          <h1 className={styles.marketingTitle}>{marketingTitle}</h1>
          <p className={styles.marketingSub}>{marketingSubtitle}</p>
          <div className={styles.carouselDots} aria-hidden>
            <span className={`${styles.dot} ${styles.dotActive}`} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </div>
        </aside>

        <div className={styles.formPanel}>
          <div className={styles.formPanelHeader}>
            <LogoMark size="small" />
            {topRight ? <div className={styles.topRight}>{topRight}</div> : <span />}
          </div>

          <div className={styles.formBody}>
            <h2 className={styles.formTitle}>{formTitle}</h2>
            {formSubtitle ? <p className={styles.formSubtitle}>{formSubtitle}</p> : null}

            {/*
            Social login — uncomment styles in AuthSplit.module.scss and restore GoogleGlyph + AppleLogo import.
            {showSocial ? (
              <>
                <div className={styles.socialStack}>
                  <button type="button" className={styles.socialBtn} onClick={onGoogleClick}>
                    <GoogleGlyph className={styles.socialIcon} />
                    Continue with Google
                  </button>
                  <button type="button" className={styles.socialBtn} onClick={onAppleClick}>
                    <AppleLogo className={styles.socialIcon} size={20} weight="fill" aria-hidden />
                    Continue with Apple
                  </button>
                </div>
                <div className={styles.divider}>Or sign in with</div>
              </>
            ) : null}
            */}

            {children}
          </div>

          <div className={styles.formFooter}>{footer ?? defaultFooter}</div>
        </div>
      </div>
    </div>
  );
}

export { APP_NAME, LogoMark };
