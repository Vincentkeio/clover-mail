import type { Metadata } from 'next';
import { getCurrentAdmin } from '@/lib/auth';
import { Nav } from '@/components/nav';
import { AppFrame } from '@/components/app-frame';
import './globals.css';

export const metadata: Metadata = {
  title: 'clover 三叶草邮局',
  description: '自托管邮局管理面板与 Cloudflare DNS 管理',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  return (
    <html lang="zh-CN">
      <body className="app-body">
        {admin ? <AppFrame><Nav username={admin.username} /><div className="app-content"><a href="#main-content" className="skip-link">跳到主要内容</a><div id="main-content" className="page-container">{children}</div></div></AppFrame> : children}
      </body>
    </html>
  );
}
