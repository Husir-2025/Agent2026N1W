import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '文脉 | 个人写作工作台',
  description: '从目标化拆书到写作审阅与成长反馈的本地工作台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="icon"
          href="/Agent2026N1W/favicon.svg"
          type="image/svg+xml"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
