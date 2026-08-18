// `with { type: "file" }` imports resolve to a path string (Bun embeds the file
// into the bundle / standalone binary). Declare the shapes for tsgo.
declare module "*.ttf" {
  const path: string;
  export default path;
}
declare module "*.wasm" {
  const path: string;
  export default path;
}
