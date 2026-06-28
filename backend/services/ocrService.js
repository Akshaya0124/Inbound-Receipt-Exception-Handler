import Tesseract from 'tesseract.js';
import pdfParse from 'pdf-parse';
import fs from 'fs';

/**
 * OCR Service
 * Step 1 of invoice extraction pipeline.
 * - Images (PNG/JPG): Tesseract.js reads pixels and outputs raw text.
 * - PDFs:            pdf-parse extracts embedded text directly.
 * The raw text is then passed to the LLM mapping step in extractionService.js.
 */

export const extractRawText = async (filePath, mimeType) => {
  console.log(`[OCR] Starting | type=${mimeType} | file=${filePath}`);

  if (mimeType === 'application/pdf') {
    const buffer = fs.readFileSync(filePath);
    const pdf = await pdfParse(buffer);
    console.log(`[OCR] PDF done | chars=${pdf.text.length}`);
    return pdf.text;
  }

  // Images — Tesseract OCR
  const { data: { text, confidence } } = await Tesseract.recognize(
    filePath,
    'eng',
    {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          process.stdout.write(`\r[OCR] Tesseract progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    }
  );

  process.stdout.write('\n');
  console.log(`[OCR] Image done | chars=${text.length} | confidence=${confidence?.toFixed(1)}%`);
  return text;
};
