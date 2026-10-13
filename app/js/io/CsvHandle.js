/**
 * File I/O handler for CSV datasets in NanoCell CSV.
 * Manages loading, streaming parsing via Web Worker, saving, and exporting 2D data matrices.
 * @module CsvHandle
 */
import { Dataframe } from '../../../core/model/Dataframe.js';
import { getSheet } from '../appContext.js';
import { Notification, showBrowserCompatibilityNotice } from '../ui/Notification.js';
import { Sheet } from '../sheet/Sheet.js';
import { stg } from '../ui/settings/Setting.js';
import { CsvSerializer } from '../../../core/csv/CsvSerializer.js';
import CsvWorker from './csv_worker.js?worker';

/**
 * Handles CSV file lifecycle operations including opening, worker-based streaming, saving, and CSV serialization.
 */
class CsvHandle {
  /**
   * Instantiates a new CsvHandle and sets up the Web Worker event listener if available.
   * @param {Object} [options={}] - Optional overrides for window, document, worker, and sheet factory.
   */
  constructor(options = {}) {
    this.win = options.window !== undefined ? options.window : (typeof window !== 'undefined' ? window : null);
    this.doc = options.document !== undefined ? options.document : (typeof document !== 'undefined' ? document : null);
    this.createSheet = options.createSheet || ((df) => new Sheet(df));
    this.handle = null;
    this.file = null;
    this.file_chunks = [];
    this.isFirstChunkLoaded = false;
    this.isReadComplete = false;
    this.viewOnly = false;
    this.readId = 0;
    this._launchingHandle = null;
    this._receivedMessageHandle = null;
    this.worker = options.worker !== undefined ? options.worker : (typeof Worker !== 'undefined' ? new CsvWorker() : null);
    if (this.worker) {
      this.worker.addEventListener("message", e => {
        let d = e?.data;
        if (!d) return;
        switch (d.cmd) {
          case "chunk_loaded": this.file_chunk_loaded(d);
        }
      });
    }
  }

  /**
   * Loads a File object into the sheet, updating the active file handle and window title.
   * @param {File} file - The File object to read.
   * @param {FileSystemFileHandle|null} [handle=null] - Associated FileSystemFileHandle if available.
   */
  loadFile(file, handle = null) {
    if (!file) return;
    this.handle = handle;
    this.file = file;
    if (this.doc) {
      this.doc.title = file.name || 'csv';
    }
    console.log("Loading : ", file.name);
    this.read(file);
  }

  /**
   * Initializes file loading from a FileSystemFileHandle.
   * @param {FileSystemFileHandle} handle - The file handle to load.
   * @returns {Promise<void>}
   */
  async launchFile(handle) {
    if (!handle || typeof handle.getFile !== 'function') return;
    if (this._launchingHandle === handle) return;
    this._launchingHandle = handle;
    try {
      const file = await handle.getFile();
      this.loadFile(file, handle);
    } finally {
      this._launchingHandle = null;
    }
  }

  /**
   * Registers all window-level file opening listeners: PWA launchQueue, cross-window postMessage
   * with opener ready handshake, and drag-and-drop (with FileSystemFileHandle preservation).
   * @param {Window} [win=this.win] - Target window object.
   */
  initListeners(win = this.win) {
    if (!win) return;

    if ('launchQueue' in win && typeof win.launchQueue?.setConsumer === 'function') {
      try {
        win.launchQueue.setConsumer(async (params) => {
          const handle = params?.files?.[0];
          if (handle) await this.launchFile(handle);
        });
      } catch (err) {
        console.warn('LaunchQueue setup failed:', err);
      }
    }

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('message', (event) => {
        const fileHandle = event?.data?.fileHandle;
        if (fileHandle && fileHandle !== this._receivedMessageHandle) {
          this._receivedMessageHandle = fileHandle;
          this.launchFile(fileHandle);
        }
      });

      win.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      win.addEventListener('dragenter', (e) => {
        e.preventDefault();
      });
      win.addEventListener('dragleave', (e) => {
        e.preventDefault();
      });
      win.addEventListener('drop', async (e) => {
        e.preventDefault();
        const item = e.dataTransfer?.items?.[0];
        if (item && typeof item.getAsFileSystemHandle === 'function') {
          try {
            const handle = await item.getAsFileSystemHandle();
            if (handle && (handle.kind === 'file' || typeof handle.getFile === 'function')) {
              await this.launchFile(handle);
              return;
            }
          } catch {}
        }
        const file = e.dataTransfer?.files?.[0];
        if (file) {
          this.loadFile(file, null);
        }
      });
    }

    if (win.opener && typeof win.opener.postMessage === 'function') {
      try {
        win.opener.postMessage({ type: 'nanocell:ready' }, '*');
      } catch {}
    }
  }

  /**
   * Handles chunk loaded event messages from the worker.
   * Progressively builds the dataset and triggers sheet initialization.
   * @param {Object} d - Worker event payload.
   */
  file_chunk_loaded(d) {
    if (d.readId !== undefined && d.readId !== this.readId) {
      return;
    }
    const fc = this.doc && typeof this.doc.getElementById === 'function' ? this.doc.getElementById("footerCenter") : null;
    const percent = Math.round(d.status * 100);
    if (fc) fc.innerHTML = percent + "%";

    if (d.chunk != null) {
      this.file_chunks.push(d.chunk);
    }

    const isFirst = d.isFirstChunk || (!this.isFirstChunkLoaded && d.chunk != null);

    if (isFirst) {
      this.isFirstChunkLoaded = true;
      let matrix = d.chunk || [[]];
      let df = new Dataframe(matrix);
      let s = this.createSheet(df);

      s.df.isSaved = true;
      s.df.lock = this.viewOnly;
      s.fixTop = stg.set_headers;

      if (d.status >= 1 || d.isComplete) {
        this.isReadComplete = true;
        this.readSuccess(s, d);
      }
      return;
    }

    // Subsequent background chunks
    let s = getSheet();
    if (s && s.df && d.chunk != null && d.chunk.length > 0) {
      s.df.appendRows(d.chunk, true);
      if (this.viewOnly) {
        s.df.isSaved = true;
      }
      if (typeof s.scrollbarRefresh === 'function') {
        s.scrollbarRefresh();
      }
      if (typeof s.refresh === 'function') {
        s.refresh();
      }
    }

    if (d.status >= 1 || d.isComplete) {
      this.isReadComplete = true;
      if (s) {
        this.readSuccess(s, d);
      }
    }
  }

  /**
   * Finalizes file loading state and triggers completion events.
   * @param {import('./Sheet.js').Sheet} [s] - The sheet instance.
   * @param {Object} [d] - Final chunk event data.
   */
  readSuccess(s, d) {
    if (!s) {
      s = getSheet();
    }
    if (s) {
      if (stg.trim && !this.viewOnly) s.df.trimAll();
      s.fixTop = stg.set_headers;
      s.df.isSaved = true;
      s.df.lock = this.viewOnly;
      if (typeof s.scrollbarRefresh === 'function') {
        s.scrollbarRefresh();
      }
      if (typeof s.refresh === 'function') {
        s.refresh();
      }
    }
  }

  /**
   * Initiates file reading by delegating parsing options to the Web Worker.
   * @param {File} file - File object to read.
   */
  read(file) {
    if (this.worker && this.readId > 0 && !this.isReadComplete) {
      this.pipe("abort", {});
    }
    this.readId = (this.readId || 0) + 1;
    const currentReadId = this.readId;
    this.file = file;
    this.file_chunks = [];
    this.isFirstChunkLoaded = false;
    this.isReadComplete = false;
    let mbSize = (file && file.size) ? file.size / 1000000 : 0;
    this.viewOnly = mbSize > Number(stg.editMaxFileSize);

    if (!file || file.size == 0) {
      this.file_chunks = [[[]]];
      this.file_chunk_loaded({
        cmd: "chunk_loaded",
        readId: currentReadId,
        status: 1.0,
        chunk: [[]],
        chunk_id: 1,
        isFirstChunk: true,
        isComplete: true,
        viewOnly: this.viewOnly
      });
    } else {
      this.pipe("read", {
        readId: currentReadId,
        file: file,
        viewOnly: this.viewOnly,
        n_chunks: stg.vo_n_chunks,
        n_rows: stg.vo_n_rows,
        trimUnquoted: Boolean(stg.trim_unquoted)
      });
    }

  }

  /**
   * Sends a command payload to the underlying Web Worker.
   * @param {string} cmd - Command identifier for worker.
   * @param {Object} data - Command payload data.
   */
  pipe(cmd, data) { if (this.worker) this.worker.postMessage({ cmd: cmd, data: data }); }

  /**
   * Fallback file picker using standard hidden file input for browsers without File System Access API.
   */
  openFallback() {
    const doc = this.doc;
    if (!doc || typeof doc.createElement !== 'function') return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.style.display = 'none';
    input.onchange = (e) => {
      const file = e.target?.files?.[0];
      if (file) {
        console.log("Loading via fallback:", file.name);
        this.loadFile(file, null);
      }
      input.remove?.();
    };
    doc.body?.appendChild(input);
    input.click?.();
  }

  /**
   * Prompts the user with a file picker to open a new CSV file in a new window.
   * Uses the native File System Access API, with fallback for unsupported browsers.
   * @returns {Promise<void>}
   */
  async open() {
    const win = this.win;
    if (!win || typeof win.showOpenFilePicker !== 'function') {
      showBrowserCompatibilityNotice();
      this.openFallback();
      return;
    }
    try {
      let [fileHandle] = await win.showOpenFilePicker(CsvHandle.pickerOptions);
      const newWindow = typeof win.open === 'function' ? win.open('./home.html', "_blank", 'width=800,height=600') : null;
      if (!newWindow) {
        // Fall back to opening in the current window if popup was blocked or in standalone mode
        await this.launchFile(fileHandle);
        return;
      }
      const sendHandle = () => {
        try {
          newWindow.postMessage({ fileHandle }, '*');
        } catch {}
      };
      const onReadyMessage = (event) => {
        if (event?.data?.type === 'nanocell:ready' && (!event.source || event.source === newWindow)) {
          win.removeEventListener?.('message', onReadyMessage);
          sendHandle();
        }
      };
      win.addEventListener?.('message', onReadyMessage);
      newWindow.onload = () => {
        sendHandle();
      };
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err instanceof TypeError || typeof win.showOpenFilePicker !== 'function') {
        showBrowserCompatibilityNotice();
        this.openFallback();
        return;
      }
      console.error('An unexpected error occurred:', err);
    }
  }

  /**
   * Reloads the active file, optionally prompting if unsaved changes exist.
   * @param {boolean} [force=false] - If true, reloads without prompting even if unsaved changes exist.
   */
  reloadFile(force = false) {
    if (this.handle === null && this.file === null) {
      return Notification.quick("No file to reload from.");
    }
    const doReload = () => {
      if (this.handle !== null) {
        return this.launchFile(this.handle);
      }
      return this.loadFile(this.file, null);
    };
    const sheet = getSheet();
    if (sheet && !sheet.df.isSaved && !force) {
      return Notification.choice("Changes will be lost ? ", doReload);
    } else {
      return doReload();
    }
  }

  /**
   * Opens a blank NanoCell window.
   */
  new() { this.win?.open?.('./home.html', "_blank", 'width=600,height=400'); }

  /**
   * Triggers the native save file picker dialog to save the current dataset under a new file path.
   * Falls back to export download on browsers without File System Access API.
   * @returns {Promise<void>}
   */
  async saveAs() {
    if (this.viewOnly) return;
    const win = this.win;
    if (!win || typeof win.showSaveFilePicker !== 'function') {
      showBrowserCompatibilityNotice();
      this.exportDownload();
      return;
    }
    try {
      this.handle = await win.showSaveFilePicker(CsvHandle.pickerOptions);
      await this.save();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err instanceof TypeError || typeof win.showSaveFilePicker !== 'function') {
        showBrowserCompatibilityNotice();
        this.exportDownload();
        return;
      }
      console.error('An unexpected error occurred:', err);
    }
  }

  /**
   * Saves the current sheet's Dataframe back to the file handle using CSV formatting.
   * @returns {Promise<void>}
   */
  async save() {
    if (this.viewOnly) return;
    if (this.handle === null) {
      await this.saveAs();
      return;
    }
    if (typeof this.handle?.createWritable !== 'function') {
      showBrowserCompatibilityNotice();
      this.exportDownload();
      return;
    }
    try {
      const writableStream = await this.handle.createWritable();
      const sheet = getSheet();
      if (!sheet) return;
      const csvContent = CsvHandle.from2D(sheet.df.data);
      await writableStream.write(csvContent);
      await writableStream.close();
      sheet.df.isSaved = true;
      sheet.refresh?.();
      this.file = await this.handle.getFile();
      if (this.doc) this.doc.title = this.file.name;
    } catch (err) {
      console.error("Error saving file:", err);
      Notification.confirm(err);
    }
  }

  /**
   * Exports a Blob by triggering a browser download via anchor element.
   * @param {Blob} [blob] - Custom Blob to download (defaults to current sheet as CSV).
   * @param {string} [filename] - Custom filename (defaults to current file name or 'export.csv').
   */
  exportDownload(blob, filename) {
    const sheet = getSheet();
    if (!sheet) return;
    const doc = this.doc;
    if (!doc) return;
    try {
      if (!blob) {
        const csvContent = CsvHandle.from2D(sheet.df.data);
        blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      }
      if (!filename) {
        filename = (this.file && this.file.name) ? this.file.name : 'export.csv';
      }
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      doc.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 100);
      sheet.df.isSaved = true;
      sheet.refresh?.();
      Notification.quick("File saved as " + filename);
    } catch (err) {
      console.error("Error downloading file:", err);
      Notification.confirm(err);
    }
  }

  /**
   * Exports the active sheet as a JSON file.
   * @param {boolean} [pretty=true] - Whether to format JSON with 2-space indentation.
   */
  exportJson(pretty = true) {
    const sheet = getSheet();
    if (!sheet?.df) return Notification.quick("No active data to export.");
    const serializer = new CsvSerializer();
    const jsonStr = serializer.serializeJson(sheet.df.data, {
      pretty,
      hasHeader: Boolean(stg.set_headers)
    });
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const baseName = (this.file?.name ? this.file.name.replace(/\.[^.]+$/, '') : 'export');
    this.exportDownload(blob, `${baseName}.json`);
  }

  /**
   * Exports the active sheet as a Tab-Separated Values (TSV) file.
   */
  exportTsv() {
    const sheet = getSheet();
    if (!sheet?.df) return Notification.quick("No active data to export.");
    const serializer = new CsvSerializer({ delimiter: '\t' });
    const tsvStr = serializer.serialize(sheet.df.data);
    const blob = new Blob([tsvStr], { type: 'text/tab-separated-values;charset=utf-8' });
    const baseName = (this.file?.name ? this.file.name.replace(/\.[^.]+$/, '') : 'export');
    this.exportDownload(blob, `${baseName}.tsv`);
  }

  /**
   * Exports the active sheet as a GitHub Flavored Markdown table file.
   */
  exportMarkdown() {
    const sheet = getSheet();
    if (!sheet?.df) return Notification.quick("No active data to export.");
    const serializer = new CsvSerializer();
    const mdStr = serializer.serializeMarkdown(sheet.df.data, {
      hasHeader: Boolean(stg.set_headers)
    });
    const blob = new Blob([mdStr], { type: 'text/markdown;charset=utf-8' });
    const baseName = (this.file?.name ? this.file.name.replace(/\.[^.]+$/, '') : 'export');
    this.exportDownload(blob, `${baseName}.md`);
  }

  /**
   * Copies the active selection as a GitHub Flavored Markdown table to clipboard.
   * @returns {Promise<void>}
   */
  async copyMarkdown() {
    const sheet = getSheet();
    if (!sheet) return;
    const serializer = new CsvSerializer();
    const md = serializer.serializeMarkdown(sheet.rangeArray(), { hasHeader: Boolean(stg.set_headers) });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
        Notification.quick("Copied selection as Markdown table");
      }
    } catch (err) {
      console.warn("Clipboard copy markdown failed:", err);
      Notification.quick("Clipboard copy not permitted by browser");
    }
  }

  /**
   * Copies the active selection as JSON to clipboard.
   * @returns {Promise<void>}
   */
  async copyJson() {
    const sheet = getSheet();
    if (!sheet) return;
    const serializer = new CsvSerializer();
    const json = serializer.serializeJson(sheet.rangeArray(), { pretty: true, hasHeader: Boolean(stg.set_headers) });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        Notification.quick("Copied selection as JSON to clipboard");
      }
    } catch (err) {
      console.warn("Clipboard copy json failed:", err);
      Notification.quick("Clipboard copy not permitted by browser");
    }
  }

  /**
   * Serializes a 2D string matrix into a formatted CSV text string based on current settings.
   * @param {Array<Array<string|number>>} matrix - 2D matrix of cell values.
   * @returns {string} Formatted CSV text.
   * @throws {string} Error message if strict CSV requirements are violated.
   */
  static from2D(matrix) {
    let sep = stg.delimiter;
    if (sep === "TAB") sep = '\t';
    const serializer = new CsvSerializer({
      delimiter: sep,
      isStrict: stg.save_strict,
      fixedWidth: stg.save_fixed_width_size
    });
    return serializer.serialize(matrix);
  }
}

/**
 * File picker options configuration for opening/saving CSV files via File System Access API.
 * @type {Object}
 */
Object.defineProperty(CsvHandle, 'pickerOptions', {
  value: {
    types: [
      {
        description: "csv (Comma Separated Value) ",
        accept: { "text/csv": [".csv", ".tsv"] }
      },
    ]
  }
});

export { CsvHandle };
