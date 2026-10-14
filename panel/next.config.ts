import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // standalone 输出：Docker runner 阶段直接 node server.js，无需 node_modules
  output: 'standalone',
  // Route collection imports SQLite initialization; serialize build workers to
  // avoid concurrent schema migrations and keep VPS build memory predictable.
  experimental: { cpus: 1 },
}

export default nextConfig
