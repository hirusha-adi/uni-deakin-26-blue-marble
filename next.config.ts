import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/prompt-chat/*': ['./SYSTEM_PROMPT.md'],
  },
}

export default nextConfig
