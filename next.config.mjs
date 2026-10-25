/** @type {import('next').NextConfig} */
const nextConfig = {
  // native / heavy server-only packages must not be bundled by webpack
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
