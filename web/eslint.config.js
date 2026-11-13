import globals from "globals";
import hooks from "eslint-plugin-react-hooks";
export default [{ ignores: ["dist/**", "node_modules/**"] }, {
  files: ["**/*.{js,jsx,mjs}"],
  languageOptions: { globals: { ...globals.browser, ...globals.node }, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "react-hooks": hooks },
  rules: { "no-undef": "error", "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
}];
