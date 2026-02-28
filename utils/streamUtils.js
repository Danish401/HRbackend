/**
 * Converts a readable stream to a Buffer
 * Useful for AWS S3 GetObject responses
 * @param {ReadableStream} stream 
 * @returns {Promise<Buffer>}
 */
const streamToBuffer = async (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

module.exports = {
  streamToBuffer
};
