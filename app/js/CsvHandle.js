import { Dataframe } from '../../core/Dataframe.js';
import { CsvSerializer } from '../../core/Csv.js';
import { getSheet, settings } from './state.js';
import { Notification, showBrowserCompatibilityNotice } from './Notification.js';
import { Sheet } from './Sheet.js';
import CsvWorker from './csvWorker.js?worker';

class CsvHandle {
  constructor(options = {}) {
    this.win = options.window !== undefined ? options.window : (typeof window !== 'undefined' ? window : null);
    this.doc = options.document !== undefined ? options.document : (typeof document !== 'undefined' ? document : null);
    this.createSheet = options.createSheet || ((df) => new Sheet(df));
    this.handle = null;
    this.file = null;
    this.isFirstChunkLoaded = false;
    this.isReadComplete = false;
    this.viewOnly = false;
    this.readId = 0;
    this._launchingHandle = null;
    this._receivedMessageHandle = null;
    this.worker = options.worker !== undefined ? options.worker : (typeof Worker !== 'undefined' ? new CsvWorker() : null);
    this.worker?.addEventListener('message', (event) => {
      if (event?.data?.cmd === 'chunk_loaded') this.onChunkLoaded(event.data);
    });
  }

  loadFile(file, handle = null) {
    if (!file) return;
    this.handle = handle;
    this.file = file;
    if (this.doc) this.doc.title = file.name || 'csv';
    console.log('Loading : ', file.name);
    this.read(file);
  }

  async launchFile(handle) {
    if (!handle || typeof handle.getFile !== 'function' || this._launchingHandle === handle) return;
    this._launchingHandle = handle;
    try {
      const file = await handle.getFile();
      this.loadFile(file, handle);
    } finally {
      this._launchingHandle = null;
    }
  }

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

      const preventDefault = (event) => event.preventDefault();
      win.addEventListener('dragover', preventDefault);
      win.addEventListener('dragenter', preventDefault);
      win.addEventListener('dragleave', preventDefault);
      win.addEventListener('drop', async (event) => {
        event.preventDefault();
        const item = event.dataTransfer?.items?.[0];
        if (item && typeof item.getAsFileSystemHandle === 'function') {
          try {
            const handle = await item.getAsFileSystemHandle();
            if (handle && (handle.kind === 'file' || typeof handle.getFile === 'function')) {
              await this.launchFile(handle);
              return;
            }
          } catch {}
        }
        const file = event.dataTransfer?.files?.[0];
        if (file) this.loadFile(file, null);
      });
    }

    try { win.opener?.postMessage?.({ type: 'nanocell:ready' }, '*'); } catch {}
  }

  onChunkLoaded(data) {
    if (data.readId !== undefined && data.readId !== this.readId) return;
    const footerCenter = this.doc?.getElementById?.('footer-center');
    if (footerCenter) footerCenter.innerHTML = `${Math.round(data.status * 100)}%`;

    const isFirst = data.isFirstChunk || (!this.isFirstChunkLoaded && data.chunk != null);
    let sheet;

    if (isFirst) {
      this.isFirstChunkLoaded = true;
      sheet = this.createSheet(new Dataframe(data.chunk || [[]]));
      sheet.df.isSaved = true;
      sheet.df.lock = this.viewOnly;
      sheet.fixTop = settings.freezeHeaderOnOpen;
    } else {
      sheet = getSheet();
      if (sheet?.df && data.chunk?.length > 0) {
        sheet.df.appendRows(data.chunk, true);
        if (this.viewOnly) sheet.df.isSaved = true;
        sheet.refreshScrollbars?.();
        sheet.refresh?.();
      }
    }

    if (data.status >= 1 || data.isComplete) {
      this.isReadComplete = true;
      if (sheet) this.onReadComplete(sheet);
    }
  }

  onReadComplete(sheet = getSheet()) {
    if (!sheet) return;
    if (settings.trim && !this.viewOnly) sheet.df.trimAll();
    sheet.fixTop = settings.freezeHeaderOnOpen;
    sheet.df.isSaved = true;
    sheet.df.lock = this.viewOnly;
    sheet.refreshScrollbars?.();
    sheet.refresh?.();
  }

  read(file) {
    if (this.worker && this.readId > 0 && !this.isReadComplete) {
      this.postToWorker('abort', {});
    }
    const currentReadId = ++this.readId;
    this.file = file;
    this.isFirstChunkLoaded = false;
    this.isReadComplete = false;
    this.viewOnly = (file?.size ? file.size / 1000000 : 0) > Number(settings.editMaxFileSize);

    if (!file || file.size == 0) {
      this.onChunkLoaded({
        cmd: 'chunk_loaded',
        readId: currentReadId,
        status: 1.0,
        chunk: [[]],
        chunkId: 1,
        isFirstChunk: true,
        isComplete: true,
        viewOnly: this.viewOnly
      });
    } else {
      this.postToWorker('read', {
        readId: currentReadId,
        file,
        viewOnly: this.viewOnly,
        previewChunks: settings.previewChunks,
        previewRows: settings.previewRows,
        trimUnquoted: Boolean(settings.trimUnquoted)
      });
    }
  }

  postToWorker(cmd, data) {
    this.worker?.postMessage({ cmd, data });
  }

  openFallback() {
    const doc = this.doc;
    if (typeof doc?.createElement !== 'function') return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.style.display = 'none';
    input.onchange = (event) => {
      const file = event.target?.files?.[0];
      if (file) this.loadFile(file, null);
      input.remove?.();
    };
    doc.body?.appendChild(input);
    input.click?.();
  }

  async open() {
    const win = this.win;
    if (typeof win?.showOpenFilePicker !== 'function') {
      showBrowserCompatibilityNotice();
      return this.openFallback();
    }
    try {
      const [fileHandle] = await win.showOpenFilePicker(CsvHandle.pickerOptions);
      const newWindow = typeof win.open === 'function' ? win.open('./home.html', '_blank', 'width=800,height=600') : null;
      if (!newWindow) return await this.launchFile(fileHandle);

      const sendHandle = () => { try { newWindow.postMessage({ fileHandle }, '*'); } catch {} };
      const onReadyMessage = (event) => {
        if (event?.data?.type === 'nanocell:ready' && (!event.source || event.source === newWindow)) {
          win.removeEventListener?.('message', onReadyMessage);
          sendHandle();
        }
      };
      win.addEventListener?.('message', onReadyMessage);
      newWindow.onload = sendHandle;
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err instanceof TypeError || typeof win.showOpenFilePicker !== 'function') {
        showBrowserCompatibilityNotice();
        return this.openFallback();
      }
      console.error('An unexpected error occurred:', err);
    }
  }

  reloadFile(force = false) {
    if (this.handle === null && this.file === null) {
      return Notification.quick('No file to reload from.');
    }
    const doReload = () => this.handle !== null ? this.launchFile(this.handle) : this.loadFile(this.file, null);
    const sheet = getSheet();
    return (sheet && !sheet.df.isSaved && !force)
      ? Notification.choice('Changes will be lost ? ', doReload)
      : doReload();
  }

  new() {
    this.win?.open?.('./home.html', '_blank', 'width=600,height=400');
  }

  async saveAs() {
    if (this.viewOnly) return;
    const win = this.win;
    if (typeof win?.showSaveFilePicker !== 'function') {
      showBrowserCompatibilityNotice();
      return this.exportDownload();
    }
    try {
      this.handle = await win.showSaveFilePicker(CsvHandle.pickerOptions);
      await this.save();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err instanceof TypeError || typeof win.showSaveFilePicker !== 'function') {
        showBrowserCompatibilityNotice();
        return this.exportDownload();
      }
      console.error('An unexpected error occurred:', err);
    }
  }

  async save() {
    if (this.viewOnly) return;
    if (this.handle === null) return await this.saveAs();
    if (typeof this.handle?.createWritable !== 'function') {
      showBrowserCompatibilityNotice();
      return this.exportDownload();
    }
    try {
      const sheet = getSheet();
      if (!sheet) return;
      const writableStream = await this.handle.createWritable();
      await writableStream.write(CsvHandle.serializeMatrix(sheet.df.data));
      await writableStream.close();
      sheet.df.isSaved = true;
      sheet.refresh?.();
      this.file = await this.handle.getFile();
      if (this.doc) this.doc.title = this.file.name;
    } catch (err) {
      console.error('Error saving file:', err);
      Notification.confirm(err);
    }
  }

  exportDownload(blob, filename) {
    const sheet = getSheet();
    const doc = this.doc;
    if (!sheet || !doc) return;
    try {
      blob ||= new Blob([CsvHandle.serializeMatrix(sheet.df.data)], { type: 'text/csv;charset=utf-8;' });
      filename ||= this.file?.name || 'export.csv';
      const url = URL.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      doc.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        anchor.remove();
      }, 100);
      sheet.df.isSaved = true;
      sheet.refresh?.();
      Notification.quick(`File saved as ${filename}`);
    } catch (err) {
      console.error('Error downloading file:', err);
      Notification.confirm(err);
    }
  }

  _exportAs(extension, mimeType, serializeFn) {
    const sheet = getSheet();
    if (!sheet?.df) return Notification.quick('No active data to export.');
    const content = serializeFn(sheet.df.data);
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const baseName = this.file?.name ? this.file.name.replace(/\.[^.]+$/, '') : 'export';
    this.exportDownload(blob, `${baseName}.${extension}`);
  }

  exportJson(pretty = true) {
    this._exportAs('json', 'application/json', (data) =>
      new CsvSerializer().serializeJson(data, { pretty, hasHeader: Boolean(settings.freezeHeaderOnOpen) })
    );
  }

  exportTsv() {
    this._exportAs('tsv', 'text/tab-separated-values', (data) =>
      new CsvSerializer({ delimiter: '\t' }).serialize(data)
    );
  }

  exportMarkdown() {
    this._exportAs('md', 'text/markdown', (data) =>
      new CsvSerializer().serializeMarkdown(data, { hasHeader: Boolean(settings.freezeHeaderOnOpen) })
    );
  }

  async _copyFormatted(message, serializeFn) {
    const sheet = getSheet();
    if (!sheet) return;
    const text = serializeFn(sheet.getSelectedMatrix());
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        Notification.quick(message);
      }
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
      Notification.quick('Clipboard copy not permitted by browser');
    }
  }

  async copyMarkdown() {
    return this._copyFormatted('Copied selection as Markdown table', (rows) =>
      new CsvSerializer().serializeMarkdown(rows, { hasHeader: Boolean(settings.freezeHeaderOnOpen) })
    );
  }

  async copyJson() {
    return this._copyFormatted('Copied selection as JSON to clipboard', (rows) =>
      new CsvSerializer().serializeJson(rows, { pretty: true, hasHeader: Boolean(settings.freezeHeaderOnOpen) })
    );
  }

  static serializeMatrix(matrix) {
    return new CsvSerializer({
      delimiter: settings.delimiter === 'TAB' ? '\t' : settings.delimiter,
      isStrict: settings.strictSave,
      fixedWidth: settings.fixedWidthSize
    }).serialize(matrix);
  }
}

CsvHandle.pickerOptions = {
  types: [{
    description: 'csv (Comma Separated Value) ',
    accept: { 'text/csv': ['.csv', '.tsv'] }
  }]
};

export { CsvHandle };
