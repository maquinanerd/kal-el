/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@kal-el/design-system", "@kal-el/editor", "@kal-el/contracts"],
  reactStrictMode: true,
};

export default nextConfig;
