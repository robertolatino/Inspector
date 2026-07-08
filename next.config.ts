import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Tus configuraciones actuales (Tailwind, PostCSS, etc.) */
  output: 'standalone', // 👈 OBLIGATORIO para despliegues en Docker/Cloud Run
};

export default nextConfig;