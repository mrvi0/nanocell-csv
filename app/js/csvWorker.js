import { CsvParser, SeparatorDetector } from '../core/Csv.js';

const CHUNK_SIZE = 500 * 1000;
const FIRST_CHUNK_TARGET = 100;
const STREAM_BATCH_ROWS = 2000;
let currentAbort = false;

function parseCsv(text, delimiter = ',', trimUnquotedWhitespace = false, commentChar = '', escapeChar = '"') {
  if (!text) return [];
  return new CsvParser({ delimiter, trimUnquotedWhitespace, commentChar, escapeChar }).parseChunk(text, true);
}

function postWorkerMessage(message) {
  (typeof self !== 'undefined' ? self : globalThis).postMessage?.(message);
}

async function loadCsv(data, postFn = postWorkerMessage) {
  if (data.viewOnly) return loadCsvViewOnly(data, postFn);
  const { file, readId, trimUnquoted, commentChar = '', escapeChar = '"' } = data;
  const fileSize = file?.size || 0;

  if (!file || fileSize === 0) {
    postFn({
      cmd: 'chunk_loaded', readId, status: 1.0, chunk: [[]], chunkId: 1,
      isFirstChunk: true, isComplete: true, viewOnly: false, sep: ',', rowCount: 0
    });
    return;
  }

  let offset = 0, iteration = 0, sep = ',', sepDetected = false;
  let totalRowsEmitted = 0, firstChunkEmitted = false;
  let pendingRows = [], pendingOffset = 0, parser = null;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const emitChunk = (rows, isFirst, isComplete, currentStatus) => {
    iteration++;
    totalRowsEmitted += rows.length;
    postFn({
      cmd: 'chunk_loaded', readId, status: isComplete ? 1.0 : currentStatus,
      chunk: rows, chunkId: iteration, isFirstChunk: isFirst,
      isComplete, viewOnly: false, sep, rowCount: totalRowsEmitted
    });
  };

  while (offset < fileSize && !currentAbort) {
    const nextSize = Math.min(CHUNK_SIZE, fileSize - offset);
    const slice = file.slice(offset, offset + nextSize);
    offset += nextSize;
    const isFileReadComplete = offset >= fileSize;

    const buf = await slice.arrayBuffer();
    if (currentAbort) return;
    const rawText = decoder.decode(buf, { stream: !isFileReadComplete });

    if (!sepDetected && rawText.length > 0) {
      sep = SeparatorDetector.detect(rawText);
      sepDetected = true;
    }
    parser ||= new CsvParser({ delimiter: sep, trimUnquotedWhitespace: Boolean(trimUnquoted), commentChar, escapeChar });

    const parsedRows = parser.parseChunk(rawText, isFileReadComplete);
    for (let r = 0; r < parsedRows.length; r++) pendingRows.push(parsedRows[r]);

    const currentStatus = Math.min(1.0, offset / fileSize);

    if (!firstChunkEmitted) {
      const available = pendingRows.length - pendingOffset;
      if (available >= FIRST_CHUNK_TARGET || isFileReadComplete) {
        const chunkSize = (!isFileReadComplete && available > FIRST_CHUNK_TARGET) ? FIRST_CHUNK_TARGET : available;
        const firstChunkRows = pendingRows.slice(pendingOffset, pendingOffset + chunkSize);
        pendingOffset += chunkSize;
        firstChunkEmitted = true;
        emitChunk(firstChunkRows, true, isFileReadComplete && pendingOffset >= pendingRows.length, currentStatus);
      }
    }

    while (firstChunkEmitted && (pendingRows.length - pendingOffset >= STREAM_BATCH_ROWS || (isFileReadComplete && pendingRows.length > pendingOffset))) {
      const remaining = pendingRows.length - pendingOffset;
      const chunkSize = isFileReadComplete ? remaining : STREAM_BATCH_ROWS;
      const chunkRows = pendingRows.slice(pendingOffset, pendingOffset + chunkSize);
      pendingOffset += chunkSize;
      emitChunk(chunkRows, false, isFileReadComplete && pendingOffset >= pendingRows.length, currentStatus);
    }

    if (pendingOffset >= pendingRows.length) {
      pendingRows = [];
      pendingOffset = 0;
    } else if (pendingOffset > 10000) {
      pendingRows = pendingRows.slice(pendingOffset);
      pendingOffset = 0;
    }
  }
}

async function loadCsvViewOnly(data, postFn = postWorkerMessage) {
  const { file, readId, previewChunks = 1, previewRows = 100, trimUnquoted, commentChar = '', escapeChar = '"' } = data;
  const fileSize = file?.size || 0;
  let sep = ',';

  for (let iteration = 1; iteration <= previewChunks && !currentAbort; iteration++) {
    const offset = (iteration - 1) * (fileSize / previewChunks);
    const slice = iteration === previewChunks
      ? file.slice(Math.max(0, fileSize - CHUNK_SIZE), fileSize)
      : file.slice(offset, Math.min(fileSize, offset + CHUNK_SIZE));

    let result = await slice.text();
    if (currentAbort) return;

    if (iteration === 1) {
      sep = SeparatorDetector.detect(result);
    } else {
      const firstNewline = result.indexOf('\n');
      if (firstNewline !== -1 && firstNewline < result.length - 1) result = result.slice(firstNewline + 1);
    }

    let matrix = parseCsv(result, sep, Boolean(trimUnquoted), commentChar, escapeChar);
    matrix = iteration === 1
      ? matrix.slice(0, previewRows)
      : (iteration === previewChunks ? matrix.slice(-previewRows) : matrix.slice(1, previewRows + 1));

    if (iteration !== 1) {
      matrix.unshift(new Array(matrix[0]?.length || 1).fill('! [...] !'));
    }

    postFn({
      cmd: 'chunk_loaded', readId, status: iteration / previewChunks,
      chunk: matrix, chunkId: iteration, isFirstChunk: iteration === 1,
      isComplete: iteration === previewChunks, viewOnly: true, sep, rowCount: 0
    });
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event) => {
    const cmd = event.data?.cmd;
    if (cmd === 'read') {
      currentAbort = false;
      loadCsv(event.data.data);
    } else if (cmd === 'abort' || cmd === 'cancel') {
      currentAbort = true;
    }
  });
}

export { parseCsv, loadCsv, loadCsvViewOnly };
export default class CsvWorkerFallback {}
