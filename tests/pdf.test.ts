import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

import pdfParse from 'pdf-parse';
import { extractPdfText } from '../src/pdf.js';

describe('extractPdfText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns extracted text when pdf-parse succeeds', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: 'CNA certified, 3 years home care' } as any);
    const result = await extractPdfText(Buffer.from('fake-pdf'));
    expect(result).toBe('CNA certified, 3 years home care');
  });

  it('returns empty string when pdf-parse throws', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('invalid pdf'));
    const result = await extractPdfText(Buffer.from('garbage'));
    expect(result).toBe('');
  });

  it('returns empty string when pdf-parse returns empty text', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: '' } as any);
    const result = await extractPdfText(Buffer.from('fake-pdf'));
    expect(result).toBe('');
  });
});
