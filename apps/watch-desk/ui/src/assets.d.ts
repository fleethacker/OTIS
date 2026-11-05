// Stylesheet imports are resolved by Bun's bundler rather than TypeScript.
declare module "*.css" {}

declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.txt" {
  const url: string;
  export default url;
}
