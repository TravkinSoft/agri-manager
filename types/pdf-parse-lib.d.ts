declare module "pdf-parse/lib/pdf-parse.js" {
  const parsePdf: (input: Buffer) => Promise<{
    text?: string;
    numpages?: number;
    info?: unknown;
  }>;
  export default parsePdf;
}
