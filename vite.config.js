import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes the build use relative asset paths so it works
// regardless of the GitHub Pages subpath (https://username.github.io/repo-name/)
export default defineConfig({
  plugins: [react()],
  base: "./",
});
