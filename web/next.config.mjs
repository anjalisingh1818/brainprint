/** @type {import('next').NextConfig} */
const nextConfig = {
  // @relate/relate loads a native library through koffi, so keep both out of the bundle.
  serverExternalPackages: ["@relate/relate", "koffi", "@huggingface/transformers", "onnxruntime-node"],
};
export default nextConfig;
