const mammoth = require('mammoth');
const pdfToImg = require('pdf-to-img');
const fs = require('fs-extra');
const path = require('path');
const ocrService = require('./ocrService');

/**
 * Multi-Format File Processor
 * Handles PDF, DOCX, and image resume formats
 */
class MultiFormatProcessor {
  constructor() {
    this.tempDir = path.join(__dirname, '../uploads/temp');
    fs.ensureDirSync(this.tempDir);
    console.log('✅ Multi-Format Processor initialized');
  }

  /**
   * Process file based on its type
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} filename - Original filename
   * @param {string} mimetype - MIME type
   * @returns {Promise<object>} - Extracted text and metadata
   */
  async processFile(fileBuffer, filename, mimetype) {
    try {
      console.log(`📂 Processing file: ${filename} (${mimetype})`);

      let result;

      if (mimetype === 'application/pdf') {
        result = await this.processPDF(fileBuffer, filename);
      } else if (
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        result = await this.processDOCX(fileBuffer, filename);
      } else if (mimetype.startsWith('image/')) {
        result = await this.processImage(fileBuffer, filename, mimetype);
      } else {
        throw new Error(`Unsupported file format: ${mimetype}`);
      }

      return {
        success: true,
        ...result,
        filename,
        mimetype
      };

    } catch (error) {
      console.error('❌ Multi-format processing error:', error.message);
      throw error;
    }
  }

  /**
   * Process PDF file
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} filename - Filename
   * @returns {Promise<object>} - Extracted text and page count
   */
  async processPDF(pdfBuffer, filename) {
    try {
      // Save to temp file for pdf-to-img processing
      const tempPath = path.join(this.tempDir, `${Date.now()}_${filename}`);
      await fs.writeFile(tempPath, pdfBuffer);

      try {
        // Get PDF info
        const pdf = await pdfToImg(tempPath);
        const totalPages = pdf.numPages;

        console.log(`📄 PDF detected: ${totalPages} page(s)`);

        // Try standard text extraction first (faster)
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(pdfBuffer);
        const rawText = pdfData.text || '';

        // Check if document is scanned (low text density)
        const isScanned = ocrService.isScannedDocument(rawText, totalPages);

        if (isScanned) {
          console.log('⚠️  Scanned PDF detected, initiating OCR...');
          
          // Render each page as image and run OCR
          const pageBuffers = [];
          
          for (let i = 1; i <= totalPages; i++) {
            const imgBuffer = await pdf.renderPage(tempPath, i, { scale: 2.0 });
            pageBuffers.push(imgBuffer);
          }

          // Run OCR on all pages
          const ocrResult = await ocrService.batchExtractPages(pageBuffers);
          
          // Clean up temp file
          await fs.remove(tempPath);

          return {
            text: ocrResult.text,
            totalPages,
            extractionMethod: 'ocr',
            confidence: ocrResult.confidence,
            isScanned: true
          };
        }

        // Clean up temp file
        await fs.remove(tempPath);

        return {
          text: rawText,
          totalPages,
          extractionMethod: 'pdf-parse',
          isScanned: false
        };

      } catch (error) {
        // Clean up temp file on error
        await fs.remove(tempPath);
        throw error;
      }

    } catch (error) {
      console.error('❌ PDF processing error:', error.message);
      throw error;
    }
  }

  /**
   * Process DOCX file
   * @param {Buffer} docxBuffer - DOCX buffer
   * @param {string} filename - Filename
   * @returns {Promise<object>} - Extracted text
   */
  async processDOCX(docxBuffer, filename) {
    try {
      console.log('📝 DOCX file detected, extracting text...');

      // Convert buffer to array buffer for mammoth
      const arrayBuffer = docxBuffer.buffer.slice(
        docxBuffer.byteOffset,
        docxBuffer.byteOffset + docxBuffer.byteLength
      );

      const result = await mammoth.extractRawText({ arrayBuffer });

      if (!result || !result.value) {
        throw new Error('No text extracted from DOCX');
      }

      console.log(`✅ DOCX processed: ${result.value.length} characters extracted`);

      return {
        text: result.value,
        totalPages: 1, // DOCX doesn't have fixed pages
        extractionMethod: 'mammoth-docx',
        messages: result.messages || [] // Any warnings from mammoth
      };

    } catch (error) {
      console.error('❌ DOCX processing error:', error.message);
      throw error;
    }
  }

  /**
   * Process image file (PNG, JPG, etc.)
   * @param {Buffer} imageBuffer - Image buffer
   * @param {string} filename - Filename
   * @param {string} mimetype - MIME type
   * @returns {Promise<object>} - Extracted text via OCR
   */
  async processImage(imageBuffer, filename, mimetype) {
    try {
      console.log(`🖼️  Image file detected (${mimetype}), running OCR...`);

      // Directly use OCR service
      const ocrResult = await ocrService.extractTextFromImage(imageBuffer);

      return {
        text: ocrResult.text,
        totalPages: 1,
        extractionMethod: 'ocr-direct',
        confidence: ocrResult.confidence
      };

    } catch (error) {
      console.error('❌ Image processing error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanup() {
    try {
      await fs.emptyDir(this.tempDir);
      console.log('✓ Temp directory cleaned');
    } catch (error) {
      console.error('Error cleaning temp directory:', error.message);
    }
  }
}

module.exports = new MultiFormatProcessor();
