declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
  }
}

declare module '*.wasm?url' {
  const src: string;
  export default src;
}
