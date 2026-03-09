const Tesseract = require('tesseract.js');
const fs = require('fs-extra');
const path = require('path');

/**
 * OCR Service using Tesseract.js
 * Extracts text from scanned documents and images
 */
class OCRService {
  constructor() {
    this.workers = {};
    this.defaultLang = 'eng';
    console.log('✅ OCR Service initialized (Tesseract.js)');
  }

  /**
   * Extract text from image file
   * @param {string} imagePath - Path to image file or Buffer
   * @param {object} options - OCR options
   * @returns {Promise<object>} - OCR result with text and confidence
   */
  async extractTextFromImage(imagePath, options = {}) {
    try {
      const {
        lang = this.defaultLang,
        logger = null,
        preserveWhitespace = true
      } = options;

      console.log('🔍 Starting OCR on image:', typeof imagePath === 'string' ? imagePath : 'Buffer');

      // Create worker if not exists
      const workerKey = `${lang}`;
      if (!this.workers[workerKey]) {
        this.workers[workerKey] = await Tesseract.createWorker(lang);
      }

      const worker = this.workers[workerKey];

      // Set logger if provided
      if (logger) {
        await worker.setParameters({
          tessedit_create_boxfile: '0',
          tessedit_create_hocr: '0',
          tessedit_create_txt: '1',
        });
      }

      // Perform OCR
      const result = await worker.recognize(imagePath);

      console.log(`✅ OCR completed with ${result.confidence}% confidence`);

      return {
        success: true,
        text: preserveWhitespace ? result.text : result.text.replace(/\s+/g, ' ').trim(),
        confidence: result.confidence,
        words: result.words || [],
        lines: result.lines || [],
        source: 'ocr-tesseract'
      };

    } catch (error) {
      console.error('❌ OCR extraction error:', error.message);
      throw error;
    }
  }

  /**
   * Extract text from PDF page (image buffer)
   * @param {Buffer} imageBuffer - Page rendered as image
   * @param {number} pageNumber - Page number for logging
   * @returns {Promise<object>} - OCR result
   */
  async extractFromPDFPage(imageBuffer, pageNumber = 1) {
    try {
      console.log(`📄 OCR processing page ${pageNumber}...`);
      
      const result = await this.extractTextFromImage(imageBuffer, {
        preserveWhitespace: true
      });

      console.log(`   Page ${pageNumber}: ${result.text.length} chars extracted (${result.confidence}% confidence)`);

      return {
        pageNumber,
        ...result
      };

    } catch (error) {
      console.error(`❌ OCR failed on page ${pageNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Batch OCR for multiple pages
   * @param {Array<Buffer>} pageBuffers - Array of page image buffers
   * @returns {Promise<object>} - Combined OCR results
   */
  async batchExtractPages(pageBuffers) {
    try {
      const results = [];
      let combinedText = '';
      let totalConfidence = 0;

      console.log(`📚 Processing ${pageBuffers.length} pages with OCR...`);

      for (let i = 0; i < pageBuffers.length; i++) {
        const pageResult = await this.extractFromPDFPage(pageBuffers[i], i + 1);
        results.push(pageResult);
        combinedText += pageResult.text + '\n\n';
        totalConfidence += pageResult.confidence;
      }

      const avgConfidence = Math.round(totalConfidence / pageBuffers.length);

      console.log(`✅ All ${pageBuffers.length} pages processed. Average confidence: ${avgConfidence}%`);

      return {
        success: true,
        text: combinedText.trim(),
        confidence: avgConfidence,
        pages: results,
        totalPages: pageBuffers.length,
        source: 'ocr-batch-tesseract'
      };

    } catch (error) {
      console.error('❌ Batch OCR failed:', error.message);
      throw error;
    }
  }

  /**
   * Detect if document is scanned (low text density in PDF)
   * @param {string} pdfText - Text extracted by pdf-parse
   * @param {number} totalPages - Total pages in PDF
   * @returns {boolean} - True if likely scanned
   */
  isScannedDocument(pdfText, totalPages = 1) {
    const charsPerPage = pdfText.length / totalPages;
    
    // Scanned PDFs typically have very low character density
    // Normal text PDFs: 500-3000+ chars/page
    // Scanned PDFs without text layer: 0-50 chars/page
    const isScanned = charsPerPage < 100;
    
    console.log(`📊 Document analysis: ${charsPerPage.toFixed(0)} chars/page - ${isScanned ? 'SCANNED' : 'TEXT-BASED'}`);
    
    return isScanned;
  }

  /**
   * Process uploaded file with automatic format detection
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} filename - Original filename
   * @param {string} mimetype - File MIME type
   * @returns {Promise<object>} - Extracted text and metadata
   */
  async processFile(fileBuffer, filename, mimetype) {
    try {
      console.log(`🔎 Analyzing file: ${filename} (${mimetype})`);

      // Handle image files directly
      if (mimetype.startsWith('image/')) {
        console.log('📷 Image file detected, running OCR...');
        return await this.extractTextFromImage(fileBuffer);
      }

      // For PDFs, check if it's scanned
      // Note: This requires the PDF to be parsed first
      // The calling code should determine if OCR is needed
      
      throw new Error(`Unsupported file type for OCR: ${mimetype}`);

    } catch (error) {
      console.error('❌ File processing error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up OCR workers
   */
  async terminateWorkers() {
    console.log('🛑 Terminating OCR workers...');
    
    for (const [key, worker] of Object.entries(this.workers)) {
      try {
        await worker.terminate();
        console.log(`   Worker ${key} terminated`);
      } catch (error) {
        console.error(`   Error terminating worker ${key}:`, error.message);
      }
    }
    
    this.workers = {};
  }

  /**
   * Get worker status
   */
  getWorkerStatus() {
    return {
      activeWorkers: Object.keys(this.workers).length,
      languages: Object.keys(this.workers)
    };
  }
}

module.exports = new OCRService();
