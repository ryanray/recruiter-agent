export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const result = await pdfParse(buffer);
    return result.text?.trim() ?? '';
  } catch (err) {
    console.error(`[PDF] Failed to extract text: ${err instanceof Error ? err.message : err}`);
    return '';
  }
}
