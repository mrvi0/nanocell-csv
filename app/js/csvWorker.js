import { CsvParser, SeparatorDetector } from '../../core/Csv.js';

const CHUNK_SIZE = 500 * 1000;
let currentAbort = false;

function parseCsv(text, delimiter = ',', trimUnquotedWhitespace = false, commentChar = '', escapeChar = '"') {
  if (!text) return [];
  return new CsvParser({ delimiter, trimUnquotedWhitespace, commentChar, escapeChar }).parseChunk(text, true);
}

function postWorkerMessage(message) {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') self.postMessage(message);
  else if (typeof globalThis !== 'undefined' && typeof globalThis.postMessage === 'function') globalThis.postMessage(message);
}

const ReaderClass = typeof FileReader !== 'undefined' ? FileReader : class {
  readAsArrayBuffer(blob) {
    Promise.resolve(blob.arrayBuffer()).then(result => this.onloadend?.({ target: { result } }));
  }
  readAsText(blob) {
    Promise.resolve(blob.text()).then(result => this.onloadend?.({ target: { result } }));
  }
};

function loadCsv(data, postFn = postWorkerMessage) {
  if (data.viewOnly) return loadCsvViewOnly(data, postFn);
  const file = data.file;
  const fileSize = file ? file.size : 0;
  const readId = data.readId;
  const trimUnquotedWhitespace = Boolean(data.trimUnquoted);
  const commentChar = data.commentChar || '';
  const escapeChar = data.escapeChar || '"';

  if (!file || fileSize === 0) {
    postFn({
      cmd: 'chunk_loaded',
      readId,
      status: 1.0,
      chunk: [[]],
      chunkId: 1,
      isFirstChunk: true,
      isComplete: true,
      viewOnly: false,
      sep: ',',
      rowCount: 0
    });
    return;
  }

  let offset = 0, iteration = 0, sep = ',', sepDetected = false;
  let totalRowsEmitted = 0, firstChunkEmitted = false;
  const FIRST_CHUNK_TARGET = 100;
  let pendingRows = [], pendingOffset = 0, parser = null;

  const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;
  const reader = new ReaderClass();

  const emitChunk = (rows, isFirst, isComplete, currentStatus) => {
    iteration++;
    totalRowsEmitted += rows.length;
    postFn({
      cmd: 'chunk_loaded',
      readId,
      status: isComplete ? 1.0 : currentStatus,
      chunk: rows,
      chunkId: iteration,
      isFirstChunk: isFirst,
      isComplete,
      viewOnly: false,
      sep,
      rowCount: totalRowsEmitted
    });
  };

  reader.onloadend = (event) => {
    if (currentAbort) return;
    const isFileReadComplete = offset >= fileSize;
    const rawText = (textDecoder && event.target.result instanceof ArrayBuffer)
      ? textDecoder.decode(event.target.result, { stream: !isFileReadComplete })
      : (event.target.result || '');

    if (!sepDetected && rawText.length > 0) {
      sep = SeparatorDetector.detect(rawText);
      sepDetected = true;
    }
    parser ||= new CsvParser({ delimiter: sep, trimUnquotedWhitespace, commentChar, escapeChar });

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

    while (firstChunkEmitted && (pendingRows.length - pendingOffset >= 2000 || (isFileReadComplete && pendingRows.length > pendingOffset))) {
      const remaining = pendingRows.length - pendingOffset;
      const chunkSize = isFileReadComplete ? remaining : 2000;
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

    if (offset < fileSize && !currentAbort) readNextSlice();
  };

  function readNextSlice() {
    if (currentAbort || (offset >= fileSize && iteration > 0 && pendingRows.length === 0)) return;
    const nextSize = Math.min(CHUNK_SIZE, fileSize - offset);
    const chunkBlob = file.slice(offset, offset + nextSize);
    offset += nextSize;
    if (textDecoder) reader.readAsArrayBuffer(chunkBlob);
    else reader.readAsText(chunkBlob, 'utf-8');
  }

  readNextSlice();
}

function loadCsvViewOnly(data, postFn = postWorkerMessage) {
  const file = data.file, readId = data.readId;
  const fileSize = file ? file.size : 0;
  let sep = ',', iteration = 0;
  const reader = new ReaderClass();
  const previewChunks = data.previewChunks || 1;
  const previewRows = data.previewRows || 100;
  const trimUnquoted = Boolean(data.trimUnquoted);
  const commentChar = data.commentChar || '';
  const escapeChar = data.escapeChar || '"';

  reader.onloadend = (event) => {
    if (currentAbort) return;
    let result = event.target.result || '';
    if (iteration === 1) {
      sep = SeparatorDetector.detect(result);
    } else {
      const firstNewline = result.indexOf('\n');
      if (firstNewline !== -1 && firstNewline < result.length - 1) result = result.slice(firstNewline + 1);
    }
    let matrix = parseCsv(result, sep, trimUnquoted, commentChar, escapeChar);
    matrix = iteration === 1
      ? matrix.slice(0, previewRows)
      : (iteration === previewChunks ? matrix.slice(-previewRows) : matrix.slice(1, previewRows + 1));

    if (iteration !== 1) {
      const colCount = matrix[0]?.length || 1;
      matrix.unshift(new Array(colCount).fill('! [...] !'));
    }

    postFn({
      cmd: 'chunk_loaded',
      readId,
      status: iteration / previewChunks,
      chunk: matrix,
      chunkId: iteration,
      isFirstChunk: iteration === 1,
      isComplete: iteration === previewChunks,
      viewOnly: true,
      sep,
      rowCount: 0
    });
    if (iteration < previewChunks && !currentAbort) readNextSlice();
  };

  function readNextSlice() {
    if (currentAbort) return;
    iteration++;
    const offset = (iteration - 1) * (fileSize / previewChunks);
    const slice = iteration === previewChunks
      ? file.slice(Math.max(0, fileSize - CHUNK_SIZE), fileSize)
      : file.slice(offset, Math.min(fileSize, offset + CHUNK_SIZE));
    reader.readAsText(slice, 'utf-8');
  }

  readNextSlice();
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.cmd === 'read') {
      currentAbort = false;
      loadCsv(event.data.data);
    } else if (event.data.cmd === 'abort' || event.data.cmd === 'cancel') {
      currentAbort = true;
    }
  });
}

export { parseCsv, loadCsv, loadCsvViewOnly };
export default class CsvWorkerFallback {}
