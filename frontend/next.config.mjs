/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['drand.cloudflare.com', 'api.drand.sh'],
  },
};

export default nextConfig;
