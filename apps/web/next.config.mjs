/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The intake API base URL used by the server-side proxy routes (src/app/api/*).
  // Defaults to the local Fastify server; set INTAKE_API_URL in production.
  env: {
    INTAKE_API_URL: process.env.INTAKE_API_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;
