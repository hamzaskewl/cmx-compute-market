import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@meteora-ag/cp-amm-sdk"],
};

export default nextConfig;
