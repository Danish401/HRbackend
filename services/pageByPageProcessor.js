const pdfToImg = require('pdf-to-img');
const pdfParse = require('pdf-parse');
const fs = require('fs-extra');
const path = require('path');
const ocrService = require('./ocrService');

/**
 * Page-by-Page PDF Processor
 * Handles multi-page resumes with intelligent processing
 */
class PageByPageProcessor {
  constructor() {
    this.tempDir = path.join(__dirname, '../uploads/temp');
    fs.ensureDirSync(this.tempDir);
  }

  /**
   * Process PDF page by page
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} filename - Filename
   * @returns {Promise<object>} - Combined text from all pages with page metadata
   */
  async processPDF(pdfBuffer, filename) {
    try {
      // Save to temp file
      const tempPath = path.join(this.tempDir, `${Date.now()}_${filename}`);
      await fs.writeFile(tempPath, pdfBuffer);

      try {
        // Get PDF info
        const pdf = await pdfToImg(tempPath);
        const totalPages = pdf.numPages;

        console.log(`📚 Processing ${totalPages} page(s) individually...`);

        // Extract text using standard parser first
        const pdfData = await pdfParse(pdfBuffer);
        const rawText = pdfData.text || '';

        // Check if scanned
        const isScanned = ocrService.isScannedDocument(rawText, totalPages);

        const pageResults = [];
        let combinedText = '';

        if (isScanned) {
          // Process each page with OCR
          for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            console.log(`   Processing page ${pageNum}/${totalPages}...`);
            
            // Render page as image
            const imgBuffer = await pdf.renderPage(tempPath, pageNum, { scale: 2.0 });
            
            // Run OCR on this page
            const pageResult = await ocrService.extractFromPDFPage(imgBuffer, pageNum);
            
            pageResults.push({
              pageNumber: pageNum,
              text: pageResult.text,
              confidence: pageResult.confidence,
              method: 'ocr'
            });

            combinedText += pageResult.text + '\n\n';
          }

          console.log(`✅ All ${totalPages} pages processed with OCR`);

        } else {
          // Process each page separately for better structure
          // Note: pdf-parse doesn't support page-by-page, so we use the full text
          // but mark it as page-processed for consistency
          
          pageResults.push({
            pageNumber: 1,
            text: rawText,
            confidence: 100, // Assumed high confidence for text-based PDF
            method: 'pdf-parse'
          });

          combinedText = rawText;
        }

        // Clean up
        await fs.remove(tempPath);

        return {
          success: true,
          text: combinedText.trim(),
          totalPages,
          pages: pageResults,
          isScanned,
          extractionMethod: isScanned ? 'ocr-page-by-page' : 'pdf-parse-single'
        };

      } catch (error) {
        await fs.remove(tempPath);
        throw error;
      }

    } catch (error) {
      console.error('❌ Page-by-page processing error:', error.message);
      throw error;
    }
  }

  /**
   * Get individual page texts as array
   * Useful for very long resumes or selective processing
   * @param {Buffer} pdfBuffer - PDF buffer
   * @returns {Promise<Array<string>>} - Array of page texts
   */
  async extractPageTexts(pdfBuffer) {
    try {
      const tempPath = path.join(this.tempDir, `${Date.now()}_pages.pdf`);
      await fs.writeFile(tempPath, pdfBuffer);

      try {
        const pdf = await pdfToImg(tempPath);
        const totalPages = pdf.numPages;
        const pageTexts = [];

        // For text-based PDFs, we can't easily split by page with pdf-parse
        // So we'll return the full text as single entry
        const pdfData = await pdfParse(pdfBuffer);
        const fullText = pdfData.text || '';

        // If it's a short resume (1-2 pages), return as-is
        if (totalPages <= 2) {
          await fs.remove(tempPath);
          return [fullText];
        }

        // For longer documents, attempt to split by common page breaks
        // This is heuristic-based and may not be perfect
        const pages = fullText.split(/\n\s*\n(?=\n|PAGE|Experience|Education)/i);
        
        await fs.remove(tempPath);
        
        return pages.length > 1 ? pages : [fullText];

      } catch (error) {
        await fs.remove(tempPath);
        throw error;
      }

    } catch (error) {
      console.error('Error extracting page texts:', error.message);
      return [];
    }
  }

  /**
   * Process specific pages only (for targeted extraction)
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {Array<number>} pageNumbers - Pages to process (1-indexed)
   * @returns {Promise<object>} - Extracted text from specified pages
   */
  async processSpecificPages(pdfBuffer, pageNumbers) {
    try {
      const tempPath = path.join(this.tempDir, `${Date.now()}_selected.pdf`);
      await fs.writeFile(tempPath, pdfBuffer);

      try {
        const pdf = await pdfToImg(tempPath);
        const totalPages = pdf.numPages;

        // Validate page numbers
        const validPages = pageNumbers.filter(p => p >= 1 && p <= totalPages);
        
        if (validPages.length === 0) {
          throw new Error('No valid page numbers provided');
        }

        console.log(`Processing selected pages: ${validPages.join(', ')}`);

        const results = [];
        let combinedText = '';

        for (const pageNum of validPages) {
          const imgBuffer = await pdf.renderPage(tempPath, pageNum, { scale: 2.0 });
          const pageResult = await ocrService.extractFromPDFPage(imgBuffer, pageNum);
          
          results.push({
            pageNumber: pageNum,
            text: pageResult.text,
            confidence: pageResult.confidence
          });

          combinedText += pageResult.text + '\n\n';
        }

        await fs.remove(tempPath);

        return {
          success: true,
          text: combinedText.trim(),
          pages: results,
          processedPages: validPages.length
        };

      } catch (error) {
        await fs.remove(tempPath);
        throw error;
      }

    } catch (error) {
      console.error('Error processing specific pages:', error.message);
      throw error;
    }
  }

  /**
   * Clean up temporary directory
   */
  async cleanup() {
    try {
      await fs.emptyDir(this.tempDir);
      console.log('✓ Page processor temp files cleaned');
    } catch (error) {
      console.error('Error cleaning temp files:', error.message);
    }
  }
}

module.exports = new PageByPageProcessor();
