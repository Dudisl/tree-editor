import type { NextConfig } from "next";
import path from "node:path";

// Source files live one directory above this demo; pin React to the demo's
// installation so both the host and Tree Editor share one hook dispatcher.
const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(typeof config.resolve.alias === "object" && !Array.isArray(config.resolve.alias)
        ? config.resolve.alias : {}),
      react: path.join(process.cwd(), "node_modules/react"),
      "react-dom": path.join(process.cwd(), "node_modules/react-dom"),
    };
    return config;
  },
};
export default config;
