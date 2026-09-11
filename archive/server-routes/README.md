# 原服务端路由（Cloudflare Workers 部署版）

`api/` 目录是原始工程的 App Router 路由处理器，运行时依赖 Cloudflare D1（env.DB）
与 R2（env.FILES）绑定，仅在 Cloudflare Workers 环境下可执行。

GitHub Pages 静态部署版不包含服务端：所有等价能力由
`lib/client-runtime.ts`（sql.js 本地 SQLite + IndexedDB 文件存储）在浏览器内实现，
路由行为与校验逻辑逐一对齐。此目录保留仅供对照与未来 Cloudflare 部署参考。
