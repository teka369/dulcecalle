import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Dexie is client-side; pages hydrate from IndexedDB in useEffect.
      // The Next 16 rule flags that load pattern across the app.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    "server/**",
    "public/sw.js",
    "public/swe-worker*",
    "public/__grok/**",
    "backend/**",
  ]),
]);

export default eslintConfig;
