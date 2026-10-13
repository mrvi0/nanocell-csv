import { CsvParser } from '../../../core/csv/CsvParser.js';
import { SeparatorDetector } from '../../../core/csv/SeparatorDetector.js';

const CHUNK_SIZE = 500 * 1000;
let currentAbort = false;

function csv_parse(s, delimiter = ',', trimUnquotedWhitespace = false, commentChar = '', escapeChar = '"') {
  if (!s) return [];
  return new CsvParser({ delimiter, trimUnquotedWhitespace, commentChar, escapeChar }).parseChunk(s, true);
}

function postWorkerMessage(msg) {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') self.postMessage(msg);
  else if (typeof globalThis !== 'undefined' && typeof globalThis.postMessage === 'function') globalThis.postMessage(msg);
}

const ReaderClass = typeof FileReader !== 'undefined' ? FileReader : class {
  readAsArrayBuffer(blob) {
    Promise.resolve(blob.arrayBuffer()).then(res => this.onloadend?.({ target: { result: res } }));
  }
  readAsText(blob) {
    Promise.resolve(blob.text()).then(res => this.onloadend?.({ target: { result: res } }));
  }
};

function loadcsv(data, postFn = postWorkerMessage) {
  if (data.viewOnly) return load_csv_view_only(data, postFn);
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
      chunk_id: 1,
      isFirstChunk: true,
      isComplete: true,
      viewOnly: false,
      sep: ',',
      rowCount: 0
    });
    return;
  }

  let offset = 0;
  let iteration = 0;
  let sep = ',';
  let sepDetected = false;
  let totalRowsEmitted = 0;
  let firstChunkEmitted = false;
  const FIRST_CHUNK_TARGET = 100;
  let pendingRows = [];
  let pendingOffset = 0;
  let parser = null;

  const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;
  const reader = new ReaderClass();

  const emit = (rows, isFirst, isComplete, currentStatus) => {
    iteration++;
    totalRowsEmitted += rows.length;
    postFn({
      cmd: 'chunk_loaded',
      readId,
      status: isComplete ? 1.0 : currentStatus,
      chunk: rows,
      chunk_id: iteration,
      isFirstChunk: isFirst,
      isComplete,
      viewOnly: false,
      sep,
      rowCount: totalRowsEmitted
    });
  };

  reader.onloadend = (e) => {
    if (currentAbort) return;
    const isFileReadComplete = offset >= fileSize;
    const rawText = (textDecoder && e.target.result instanceof ArrayBuffer)
      ? textDecoder.decode(e.target.result, { stream: !isFileReadComplete })
      : (e.target.result || '');

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
        emit(firstChunkRows, true, isFileReadComplete && pendingOffset >= pendingRows.length, currentStatus);
      }
    }

    while (firstChunkEmitted && (pendingRows.length - pendingOffset >= 2000 || (isFileReadComplete && pendingRows.length > pendingOffset))) {
      const remaining = pendingRows.length - pendingOffset;
      const chunkSize = isFileReadComplete ? remaining : 2000;
      const chunkRows = pendingRows.slice(pendingOffset, pendingOffset + chunkSize);
      pendingOffset += chunkSize;
      emit(chunkRows, false, isFileReadComplete && pendingOffset >= pendingRows.length, currentStatus);
    }

    if (pendingOffset >= pendingRows.length) {
      pendingRows = [];
      pendingOffset = 0;
    } else if (pendingOffset > 10000) {
      pendingRows = pendingRows.slice(pendingOffset);
      pendingOffset = 0;
    }

    if (offset < fileSize && !currentAbort) seek();
  };

  function seek() {
    if (currentAbort || (offset >= fileSize && iteration > 0 && pendingRows.length === 0)) return;
    const nextSize = Math.min(CHUNK_SIZE, fileSize - offset);
    const chunkBlob = file.slice(offset, offset + nextSize);
    offset += nextSize;
    if (textDecoder) reader.readAsArrayBuffer(chunkBlob);
    else reader.readAsText(chunkBlob, 'utf-8');
  }

  seek();
}

function load_csv_view_only(data, postFn = postWorkerMessage) {
  const file = data.file;
  const readId = data.readId;
  const fileSize = file ? file.size : 0;
  let sep = ',';
  const reader = new ReaderClass();
  let iteration = 0;
  const vo_n_chunks = data.n_chunks || 1;
  const vo_n_rows = data.n_rows || 100;
  const trimUnquoted = Boolean(data.trimUnquoted);
  const commentChar = data.commentChar || '';
  const escapeChar = data.escapeChar || '"';

  reader.onloadend = (e) => {
    if (currentAbort) return;
    let result = e.target.result || '';
    if (iteration === 1) {
      sep = SeparatorDetector.detect(result);
    } else {
      const firstNl = result.indexOf('\n');
      if (firstNl !== -1 && firstNl < result.length - 1) result = result.slice(firstNl + 1);
    }
    let matrix = csv_parse(result, sep, trimUnquoted, commentChar, escapeChar);
    matrix = iteration === 1
      ? matrix.slice(0, vo_n_rows)
      : (iteration === vo_n_chunks ? matrix.slice(-vo_n_rows) : matrix.slice(1, vo_n_rows + 1));

    if (iteration !== 1) {
      const colCount = matrix[0]?.length || 1;
      matrix.unshift(new Array(colCount).fill('! [...] !'));
    }

    postFn({
      cmd: 'chunk_loaded',
      readId,
      status: iteration / vo_n_chunks,
      chunk: matrix,
      chunk_id: iteration,
      isFirstChunk: iteration === 1,
      isComplete: iteration === vo_n_chunks,
      viewOnly: true,
      sep,
      rowCount: 0
    });
    if (iteration < vo_n_chunks && !currentAbort) seek();
  };

  function seek() {
    if (currentAbort) return;
    iteration++;
    const offset = (iteration - 1) * (fileSize / vo_n_chunks);
    const slice = iteration === vo_n_chunks
      ? file.slice(Math.max(0, fileSize - CHUNK_SIZE), fileSize)
      : file.slice(offset, Math.min(fileSize, offset + CHUNK_SIZE));
    reader.readAsText(slice, 'utf-8');
  }

  seek();
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.cmd === 'read') {
      currentAbort = false;
      loadcsv(e.data.data);
    } else if (e.data.cmd === 'abort' || e.data.cmd === 'cancel') {
      currentAbort = true;
    }
  });
}

export { csv_parse, loadcsv, load_csv_view_only };
export default class CsvWorkerFallback {}

