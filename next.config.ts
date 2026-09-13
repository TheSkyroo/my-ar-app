import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder so Turbopack ignores the stray
  // package-lock.json in the parent directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
