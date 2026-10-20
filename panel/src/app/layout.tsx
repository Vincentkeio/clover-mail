import type { Metadata } from 'next';
import { getCurrentAdmin } from '@/lib/auth';
import { Nav } from '@/components/nav';
import { LocaleProvider } from '@/lib/i18n/client';
import { HTML_LANG } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('common.appTitle'),
    description: t('common.appDescription'),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [admin, { locale, t }] = await Promise.all([getCurrentAdmin(), getI18n()]);
  return (
    <html lang={HTML_LANG[locale]}>
      <body className="app-body">
        <LocaleProvider initialLocale={locale}>
          {admin ? <div className="app-frame"><Nav username={admin.username} /><div className="app-content"><a href="#main-content" className="skip-link">{t('common.skipToContent')}</a><div id="main-content" className="page-container">{children}</div></div></div> : children}
        </LocaleProvider>
      </body>
    </html>
  );
}
