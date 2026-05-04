/**
 * Vite の `?raw` インポートを TypeScript が解決できるようにする。
 */
declare module "*.sc?raw" {
  const raw_text: string;
  export default raw_text;
}
