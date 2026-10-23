import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  outputFileTracingIncludes: {
    '/api/prompt-chat/*': ['./SYSTEM_PROMPT.md'],
  },
}

export default nextConfig
