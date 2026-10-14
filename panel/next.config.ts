import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // standalone 输出：Docker runner 阶段直接 node server.js，无需 node_modules
  output: 'standalone',
}

export default nextConfig
