export default [
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-constant-condition": "error",
    },
  },
];
