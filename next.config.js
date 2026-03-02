/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Cloudflare Pages + static export:
  // trailingSlash=false evita 404 ao acessar /auth (sem barra final).
  trailingSlash: false,
  images: { unoptimized: true },
  // deixa build "à prova de sofrimento" no Cloudflare
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
module.exports = nextConfig;
