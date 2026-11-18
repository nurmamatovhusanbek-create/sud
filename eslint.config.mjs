import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// UI / logic boundary (docs/ui-split-plan.md, M1): a component may not reach for data or domain modules. The same list drives the ratchet
// test (src/lib/__tests__/ui-boundary.test.ts); files that still violate it today are listed in its baseline and exempt here, so the
// editor flags every NEW violation at once and the exemption list only shrinks.
const boundary = JSON.parse(readFileSync(new URL("./src/lib/ui-boundary.rules.json", import.meta.url), "utf8"));
const baseline = Object.keys(JSON.parse(readFileSync(new URL("./src/lib/__tests__/ui-boundary.baseline.json", import.meta.url), "utf8")));

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules — the React Compiler advisory family (eslint-plugin-react-hooks
    // v6). These flag intentional, correct patterns in this app: hydration
    // guards (useEffect(() => setHydrated(true), [])) and useRef(fn).current
    // memoization. Disabled to match the rest of the family already off below.
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/refs": "off",
    "react-hooks/use-memo": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  files: ["src/components/**/*.{ts,tsx}"],
  ignores: ["src/components/**/__tests__/**", ...baseline],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [{
        group: boundary.forbidden.flatMap((m) => [m, m + "/**"]),
        allowTypeImports: true,
        message: "A component gets its data and actions from a feature hook (src/features/<screen>), not from this module. docs/ui-split-plan.md.",
      }],
    }],
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills/**", "sud-billing-lookup/**", "mini-services/**", "scripts/**", "upload/**", "tool-results/**", "download/**"]
}];

export default eslintConfig;
