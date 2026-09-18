/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        // Garage / S3 compatível local
        protocol: "http",
        hostname: "localhost",
        port: "3900",
        pathname: "/**",
      },
    ],
  },
  allowedDevOrigins: ['192.168.18.75'],
};

export default nextConfig;
