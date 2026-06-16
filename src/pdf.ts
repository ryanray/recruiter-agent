export type PdfExtractMethod = 'pdf-parse' | 'claude-document' | 'none';

export interface PdfExtractResult {
  text: string;
  method: PdfExtractMethod;
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.slice(0, 4).toString('ascii') === '%PDF';
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  // Try pdf-parse first
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const result = await pdfParse(buffer);
    const text = result.text?.trim() ?? '';
    if (text) return { text, method: 'pdf-parse' };
  } catch {
    // fall through to Claude fallback
  }

  // Only attempt Claude if buffer looks like a real PDF — avoids unnecessary API calls
  if (!isPdfBuffer(buffer)) {
    return { text: '', method: 'none' };
  }

  // Fallback: Claude document API (handles scanned/image PDFs)
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: buffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: 'Extract all text from this PDF resume. Return only the extracted text with no commentary.',
          },
        ],
      }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (text) return { text, method: 'claude-document' };
  } catch (err) {
    console.error(`[PDF] Claude document fallback failed: ${err instanceof Error ? err.message : err}`);
  }

  return { text: '', method: 'none' };
}
