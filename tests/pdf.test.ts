import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

import pdfParse from 'pdf-parse';
import Anthropic from '@anthropic-ai/sdk';
import { extractPdfText } from '../src/pdf.js';

const PDF_MAGIC = Buffer.from('%PDF-1.4 fake pdf content');

describe('extractPdfText', () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(Anthropic).mockImplementation(function() {
      return { messages: { create: mockCreate } } as any;
    });
  });

  it('returns text with method pdf-parse when pdf-parse succeeds', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: 'CNA certified, 3 years home care' } as any);
    const result = await extractPdfText(Buffer.from('fake-pdf'));
    expect(result.text).toBe('CNA certified, 3 years home care');
    expect(result.method).toBe('pdf-parse');
  });

  it('falls back to Claude when pdf-parse throws and buffer is a real PDF', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('invalid pdf'));
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'CNA, home care experience' }] });
    const result = await extractPdfText(PDF_MAGIC);
    expect(result.text).toBe('CNA, home care experience');
    expect(result.method).toBe('claude-document');
  });

  it('falls back to Claude when pdf-parse returns empty text and buffer is a real PDF', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: '' } as any);
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Scanned resume text' }] });
    const result = await extractPdfText(PDF_MAGIC);
    expect(result.text).toBe('Scanned resume text');
    expect(result.method).toBe('claude-document');
  });

  it('returns none when pdf-parse fails and buffer is not a real PDF (skips Claude)', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('invalid pdf'));
    const result = await extractPdfText(Buffer.from('not a pdf'));
    expect(result.text).toBe('');
    expect(result.method).toBe('none');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns none when both pdf-parse and Claude fail', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('invalid pdf'));
    mockCreate.mockRejectedValue(new Error('API error'));
    const result = await extractPdfText(PDF_MAGIC);
    expect(result.text).toBe('');
    expect(result.method).toBe('none');
  });

  it('returns none when Claude returns empty text', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: '' } as any);
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    const result = await extractPdfText(PDF_MAGIC);
    expect(result.text).toBe('');
    expect(result.method).toBe('none');
  });
});
