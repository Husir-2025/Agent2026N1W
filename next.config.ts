import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 静态导出：GitHub Pages 只能托管静态文件，应用的所有数据逻辑
  // 由 lib/client-runtime.ts 在浏览器端（IndexedDB + sql.js）完成。
  output: 'export',
  // GitHub Pages 项目站点部署在 https://<user>.github.io/Agent2026N1W/ 下，
  // 因此所有静态资源前缀 /Agent2026N1W。
  // 注意：不使用 basePath —— vinext 静态导出的预渲染会以裸路径请求页面，
  // 设置 basePath 会导致预渲染 404；assetPrefix 只改写资源引用，不影响路由。
  assetPrefix: '/Agent2026N1W',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
