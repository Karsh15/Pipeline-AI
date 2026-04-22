/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }] },
  testTimeout: 15000,
  verbose: true,
};
