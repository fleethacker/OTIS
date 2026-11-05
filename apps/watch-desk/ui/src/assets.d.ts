// Stylesheet imports are resolved by Bun's bundler rather than TypeScript.
declare module "*.css" {}

declare module "*.webp" {
  const url: string;
  export default url;
}

declare module "*.txt" {
  const url: string;
  export default url;
}
