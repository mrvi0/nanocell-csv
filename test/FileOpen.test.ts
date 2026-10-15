import assert from 'node:assert';
import { loadCsv, loadCsvViewOnly } from '../app/js/csvWorker.js';
import { getSheet, setSheet } from '../app/js/state.js';
import { Dataframe } from '../app/core/Dataframe.js';

if (typeof globalThis.HTMLElement === 'undefined') {
  (globalThis as any).HTMLElement = class {
    style = { setProperty: () => {} };
    classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    children: any[] = [];
    parentNode: any = null;
    appendChild(child: any) {
      if (child && typeof child === 'object') child.parentNode = this;
      this.children.push(child);
      return child;
    }
    contains(child: any) {
      return this.children.includes(child);
    }
    setAttribute() {}
    addEventListener() {}
    removeEventListener() {}
    remove() {
      this.parentNode = null;
    }
    focus() {}
  };
}
if (typeof globalThis.customElements === 'undefined') {
  (globalThis as any).customElements = {
    get: () => undefined,
    define: () => {}
  };
}
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => new (globalThis as any).HTMLElement(),
    documentElement: { setAttribute: () => {} },
    body: new (globalThis as any).HTMLElement()
  };
}

const { CsvHandle } = await import('../app/js/CsvHandle.js');
const { Setting, settings } = await import('../app/js/state.js');

/**
 * Creates a File-like Blob with a `.name` property for headless Node testing.
 */
function createTestFile(content: string, name = 'test.csv'): File {
  const blob = new Blob([content], { type: 'text/csv' }) as any;
  blob.name = name;
  blob.lastModified = Date.now();
  return blob as File;
}

/**
 * Creates a mock FileSystemFileHandle wrapping mutable text content.
 */
function createMockFileHandle(initialContent: string, name = 'data.csv') {
  let currentContent = initialContent;
  let writtenContent: string | null = null;
  let getFileCalls = 0;

  const handle: any = {
    kind: 'file',
    name,
    async getFile() {
      getFileCalls++;
      return createTestFile(currentContent, name);
    },
    async createWritable() {
      let buffer = '';
      return {
        async write(data: string) {
          buffer += data;
        },
        async close() {
          writtenContent = buffer;
          currentContent = buffer;
        }
      };
    },
    setContent(nextContent: string) {
      currentContent = nextContent;
    },
    getWrittenContent() {
      return writtenContent;
    },
    getCallCount() {
      return getFileCalls;
    }
  };
  return handle;
}

/**
 * Creates an in-process worker adapter connected to `csvWorker.js` functions (`loadCsv` and `loadCsvViewOnly`).
 */
function createWorkerAdapter() {
  const listeners = new Set<Function>();
  const postedCommands: Array<{ cmd: string; data: any }> = [];

  const postToClient = (msg: any) => {
    for (const fn of listeners) {
      fn({ data: msg });
    }
  };

  const worker = {
    postedCommands,
    emitMessage(msg: any) {
      postToClient(msg);
    },
    addEventListener(type: string, fn: Function) {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener(type: string, fn: Function) {
      if (type === 'message') listeners.delete(fn);
    },
    postMessage(payload: { cmd: string; data: any }) {
      postedCommands.push(payload);
      const { cmd, data } = payload;
      if (cmd === 'read') {
        if (data.viewOnly) {
          loadCsvViewOnly(data, postToClient);
        } else {
          loadCsv(data, postToClient);
        }
      }
    }
  };

  return worker;
}

/**
 * Creates a isolated mock browser environment (window, document, sheet container, worker) for testing CsvHandle.
 */
function createMockTestHarness(options: {
  opener?: any;
  withLaunchQueue?: boolean;
} = {}) {
  Setting.init();
  Setting.resetDefault();

  const winListeners = new Map<string, Set<Function>>();
  let launchConsumer: ((params: any) => Promise<void> | void) | null = null;
  let lastCreatedInput: any = null;
  const footerCenter = { innerHTML: '' };

  const mockDocument: any = {
    title: 'csv',
    getElementById(id: string) {
      if (id === 'footer-center') return footerCenter;
      return null;
    },
    createElement(tag: string) {
      const el: any = {
        tagName: tag.toUpperCase(),
        type: '',
        accept: '',
        style: {},
        files: [],
        onchange: null,
        removed: false,
        clicked: false,
        click() {
          el.clicked = true;
        },
        remove() {
          el.removed = true;
        }
      };
      if (tag === 'input') {
        lastCreatedInput = el;
      }
      return el;
    },
    body: {
      children: [] as any[],
      appendChild(el: any) {
        this.children.push(el);
      }
    }
  };

  const mockWindow: any = {
    opener: options.opener || null,
    addEventListener(type: string, fn: Function) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Function) {
      winListeners.get(type)?.delete(fn);
    },
    async dispatchEvent(type: string, event: any = {}) {
      const fns = Array.from(winListeners.get(type) || []);
      for (const fn of fns) {
        await fn(event);
      }
    },
    postMessage(data: any, _targetOrigin?: string, source?: any) {
      return mockWindow.dispatchEvent('message', { data, source });
    }
  };

  if (options.withLaunchQueue !== false) {
    mockWindow.launchQueue = {
      setConsumer(fn: (params: any) => Promise<void> | void) {
        launchConsumer = fn;
      }
    };
  }

  // Initialize with default "Hello World" sheet just like initApp()
  const createMockSheet = (df: Dataframe) => {
    const sheet: any = {
      df,
      fixTop: false,
      refreshCount: 0,
      refreshScrollbarsCount: 0,
      reloadCount: 0,
      refresh() {
        this.refreshCount++;
      },
      refreshScrollbars() {
        this.refreshScrollbarsCount++;
      },
      reload() {
        this.reloadCount++;
      }
    };
    setSheet(sheet);
    return sheet;
  };

  createMockSheet(new Dataframe([['Hello World']]));

  const worker = createWorkerAdapter();
  const csvHandle = new CsvHandle({
    window: mockWindow,
    document: mockDocument,
    worker,
    createSheet: createMockSheet
  });

  return {
    csvHandle,
    mockWindow,
    mockDocument,
    worker,
    footerCenter,
    getLaunchConsumer: () => launchConsumer,
    getLastCreatedInput: () => lastCreatedInput
  };
}

/**
 * Waits until `csvHandle.isReadComplete` becomes true (or times out).
 */
async function waitForReadComplete(csvHandle: CsvHandle, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!csvHandle.isReadComplete) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for CsvHandle read completion');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

export async function runFileOpenTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(err);
    }
  }

  console.log('\n--- Running File Open Pathways & Boot Lifecycle Test Suite ---');

  // =========================================================================
  // WAY 1: OS File Association / PWA LaunchQueue (Double-clicking a CSV file)
  // =========================================================================
  await test('Way 1 (PWA LaunchQueue): Double-clicking a CSV file replaces "Hello World" sheet with parsed file', async () => {
    const { csvHandle, mockDocument, getLaunchConsumer, footerCenter } = createMockTestHarness();
    csvHandle.initListeners();

    assert.deepStrictEqual(getSheet().df.data, [['Hello World']]);
    const consumer = getLaunchConsumer();
    assert.strictEqual(typeof consumer, 'function', 'launchQueue consumer should be registered');

    const handle = createMockFileHandle('id,name,score\n1,Alice,95\n2,Bob,88\n', 'grades.csv');
    await consumer!({ files: [handle] });
    await waitForReadComplete(csvHandle);

    assert.strictEqual(csvHandle.handle, handle);
    assert.strictEqual(mockDocument.title, 'grades.csv');
    assert.strictEqual(footerCenter.innerHTML, '100%');
    assert.deepStrictEqual(getSheet().df.data, [
      ['id', 'name', 'score'],
      ['1', 'Alice', '95'],
      ['2', 'Bob', '88']
    ]);
    assert.strictEqual(getSheet().df.isSaved, true);
    assert.strictEqual(getSheet().df.lock, false);
  });

  await test('Way 1 Edge Cases: Empty launchQueue params, 0-byte file, and concurrent duplicate launch protection', async () => {
    const { csvHandle, mockDocument, getLaunchConsumer } = createMockTestHarness();
    csvHandle.initListeners();
    const consumer = getLaunchConsumer()!;

    // 1. Null / empty files array should not overwrite "Hello World"
    await consumer(null);
    await consumer({ files: [] });
    assert.deepStrictEqual(getSheet().df.data, [['Hello World']]);

    // 2. Concurrent duplicate launchFile with same handle only calls getFile() once
    const slowHandle = createMockFileHandle('a,b\n1,2', 'once.csv');
    const [p1, p2] = [csvHandle.launchFile(slowHandle), csvHandle.launchFile(slowHandle)];
    await Promise.all([p1, p2]);
    await waitForReadComplete(csvHandle);
    assert.strictEqual(slowHandle.getCallCount(), 1);
    assert.deepStrictEqual(getSheet().df.data, [['a', 'b'], ['1', '2']]);

    // 3. 0-byte empty CSV file replaces sheet with [[]] and marks read complete
    const emptyHandle = createMockFileHandle('', 'empty.csv');
    await consumer({ files: [emptyHandle] });
    await waitForReadComplete(csvHandle);
    assert.strictEqual(mockDocument.title, 'empty.csv');
    assert.deepStrictEqual(getSheet().df.data, [['']]);
    assert.strictEqual(csvHandle.isReadComplete, true);
  });

  // =========================================================================
  // WAY 2: Ctrl+O (`csvHandle.open()`) -> New Window (`postMessage` + `nanocell:ready`)
  // =========================================================================
  await test('Way 2 (Ctrl+O New Window): showOpenFilePicker opens new window and transfers handle on onload', async () => {
    const parent = createMockTestHarness();
    const pickedHandle = createMockFileHandle('col1,col2\nval1,val2', 'picked.csv');

    let childHarness: ReturnType<typeof createMockTestHarness> | null = null;
    parent.mockWindow.showOpenFilePicker = async () => [pickedHandle];
    parent.mockWindow.open = (_url: string, _target: string, _features: string) => {
      childHarness = createMockTestHarness({ opener: parent.mockWindow });
      childHarness.csvHandle.initListeners();
      return childHarness.mockWindow;
    };

    await parent.csvHandle.open();
    assert.ok(childHarness, 'New child window should be created');

    // Trigger onload on the new window
    childHarness!.mockWindow.onload?.();
    await waitForReadComplete(childHarness!.csvHandle);

    assert.strictEqual(childHarness!.csvHandle.handle, pickedHandle);
    assert.strictEqual(childHarness!.mockDocument.title, 'picked.csv');
    assert.deepStrictEqual(getSheet().df.data, [
      ['col1', 'col2'],
      ['val1', 'val2']
    ]);
  });

  await test('Way 2 Edge Case (Handshake Recovery): Child window still receives fileHandle via nanocell:ready if onload fired before initListeners', async () => {
    const parent = createMockTestHarness();
    const pickedHandle = createMockFileHandle('city,pop\nZurich,400000', 'zurich.csv');

    let childHarness: ReturnType<typeof createMockTestHarness> | null = null;
    parent.mockWindow.showOpenFilePicker = async () => [pickedHandle];
    parent.mockWindow.open = () => {
      // Child window is created, but its module script hasn't called initListeners() yet!
      childHarness = createMockTestHarness({ opener: parent.mockWindow });
      return childHarness.mockWindow;
    };

    await parent.csvHandle.open();
    // 1. onload fires prematurely BEFORE child calls initListeners() — message is lost!
    childHarness!.mockWindow.onload?.();
    assert.strictEqual(childHarness!.csvHandle.handle, null);

    // 2. Now child finishes booting and calls initListeners(), which sends { type: 'nanocell:ready' } to opener
    childHarness!.csvHandle.initListeners();
    await waitForReadComplete(childHarness!.csvHandle);

    assert.strictEqual(childHarness!.csvHandle.handle, pickedHandle);
    assert.strictEqual(childHarness!.mockDocument.title, 'zurich.csv');
    assert.deepStrictEqual(getSheet().df.data, [
      ['city', 'pop'],
      ['Zurich', '400000']
    ]);

    // 3. Even if onload fires again later, deduplication prevents reloading the same handle twice
    childHarness!.mockWindow.onload?.();
    assert.strictEqual(pickedHandle.getCallCount(), 1);
  });

  // =========================================================================
  // WAY 3: Ctrl+O (`csvHandle.open()`) In-Place Fallback (Standalone / Popup Blocked)
  // =========================================================================
  await test('Way 3 (Ctrl+O In-Place): Opens file in current window when window.open returns null, and ignores AbortError', async () => {
    const { csvHandle, mockWindow, mockDocument } = createMockTestHarness();
    const handle = createMockFileHandle('k,v\nalpha,100', 'inplace.csv');

    // First test AbortError (user cancelled file picker)
    mockWindow.showOpenFilePicker = async () => {
      const err = new Error('User cancelled');
      err.name = 'AbortError';
      throw err;
    };
    await csvHandle.open();
    assert.deepStrictEqual(getSheet().df.data, [['Hello World']]);

    // Next test standalone / popup-blocked mode where window.open returns null
    mockWindow.showOpenFilePicker = async () => [handle];
    mockWindow.open = () => null;

    await csvHandle.open();
    await waitForReadComplete(csvHandle);

    assert.strictEqual(csvHandle.handle, handle);
    assert.strictEqual(mockDocument.title, 'inplace.csv');
    assert.deepStrictEqual(getSheet().df.data, [
      ['k', 'v'],
      ['alpha', '100']
    ]);
  });

  // =========================================================================
  // WAY 4: Fallback `<input type="file">` (`csvHandle.openFallback()`)
  // =========================================================================
  await test('Way 4 (Fallback Input Picker): Uses hidden <input type="file"> when showOpenFilePicker is unsupported or throws TypeError', async () => {
    const { csvHandle, mockWindow, mockDocument, getLastCreatedInput } = createMockTestHarness();
    delete mockWindow.showOpenFilePicker;

    await csvHandle.open();
    const input = getLastCreatedInput();
    assert.ok(input, 'Fallback <input type="file"> should be created');
    assert.strictEqual(input.type, 'file');
    assert.strictEqual(input.clicked, true);

    const file = createTestFile('product,price\nBook,15.5', 'catalog.csv');
    input.onchange({ target: { files: [file] } });
    await waitForReadComplete(csvHandle);

    assert.strictEqual(csvHandle.handle, null);
    assert.strictEqual(csvHandle.file, file);
    assert.strictEqual(mockDocument.title, 'catalog.csv');
    assert.strictEqual(input.removed, true);
    assert.deepStrictEqual(getSheet().df.data, [
      ['product', 'price'],
      ['Book', '15.5']
    ]);
  });

  // =========================================================================
  // WAY 5: Drag and Drop (`drop` event with FileSystemFileHandle & File fallback)
  // =========================================================================
  await test('Way 5a (Drag & Drop with FileSystemFileHandle): Preserves file handle so Ctrl+S saves directly in-place', async () => {
    const { csvHandle, mockWindow, mockDocument } = createMockTestHarness();
    csvHandle.initListeners();

    const droppedHandle = createMockFileHandle('x,y\n10,20', 'dropped_handle.csv');
    let prevented = false;

    await mockWindow.dispatchEvent('drop', {
      preventDefault() {
        prevented = true;
      },
      dataTransfer: {
        items: [
          {
            async getAsFileSystemHandle() {
              return droppedHandle;
            }
          }
        ],
        files: []
      }
    });
    await waitForReadComplete(csvHandle);

    assert.strictEqual(prevented, true);
    assert.strictEqual(csvHandle.handle, droppedHandle);
    assert.strictEqual(mockDocument.title, 'dropped_handle.csv');
    assert.deepStrictEqual(getSheet().df.data, [
      ['x', 'y'],
      ['10', '20']
    ]);

    // Verify in-place save works using the preserved handle!
    getSheet().df.data[1][1] = '99';
    getSheet().df.isSaved = false;
    await csvHandle.save();
    assert.strictEqual(getSheet().df.isSaved, true);
    assert.strictEqual(droppedHandle.getWrittenContent(), 'x,y\r\n10,99');
  });

  await test('Way 5b (Drag & Drop with standard File fallback): Loads from dataTransfer.files[0] when getAsFileSystemHandle is unavailable', async () => {
    const { csvHandle, mockWindow, mockDocument } = createMockTestHarness();
    csvHandle.initListeners();

    const droppedFile = createTestFile('lang,year\nRust,2015', 'langs.csv');
    let dragOverPrevented = false;
    await mockWindow.dispatchEvent('dragover', {
      preventDefault() {
        dragOverPrevented = true;
      }
    });
    assert.strictEqual(dragOverPrevented, true);

    await mockWindow.dispatchEvent('drop', {
      preventDefault() {},
      dataTransfer: {
        files: [droppedFile]
      }
    });
    await waitForReadComplete(csvHandle);

    assert.strictEqual(csvHandle.handle, null);
    assert.strictEqual(csvHandle.file, droppedFile);
    assert.strictEqual(mockDocument.title, 'langs.csv');
    assert.deepStrictEqual(getSheet().df.data, [
      ['lang', 'year'],
      ['Rust', '2015']
    ]);
  });

  // =========================================================================
  // WAY 6: Reload File (`reloadFile()`), View-Only Mode, and Stale Stream Aborts
  // =========================================================================
  await test('Way 6 (reloadFile): Supports both FileSystemFileHandle and File fallback, with unsaved-changes confirmation guard', async () => {
    const { csvHandle } = createMockTestHarness();

    // 1. Reload with no file open returns quick notification
    const noFileNotif: any = csvHandle.reloadFile();
    assert.strictEqual(noFileNotif.message, 'No file to reload from.');

    // 2. Open with FileSystemFileHandle, modify disk content, and reload
    const handle = createMockFileHandle('h1,h2\nv1,v2', 'reloadable.csv');
    await csvHandle.launchFile(handle);
    await waitForReadComplete(csvHandle);
    assert.deepStrictEqual(getSheet().df.data, [['h1', 'h2'], ['v1', 'v2']]);

    // Update underlying file on disk
    handle.setContent('h1,h2\nv1_updated,v2_updated');

    // Mark sheet as having unsaved changes
    getSheet().df.data[1][0] = 'local_unsaved_edit';
    getSheet().df.isSaved = false;

    // Calling reloadFile(false) should prompt choice instead of overwriting immediately
    const choiceNotif: any = csvHandle.reloadFile(false);
    assert.strictEqual(choiceNotif.message, 'Changes will be lost ? ');
    assert.strictEqual(getSheet().df.data[1][0], 'local_unsaved_edit');

    // Confirming the prompt triggers the reload from disk
    await choiceNotif.options.onConfirm();
    await waitForReadComplete(csvHandle);
    assert.deepStrictEqual(getSheet().df.data, [
      ['h1', 'h2'],
      ['v1_updated', 'v2_updated']
    ]);
    assert.strictEqual(getSheet().df.isSaved, true);

    // 3. Reloading when opened via File fallback (handle === null, file !== null)
    const fallbackFile = createTestFile('f1,f2\n100,200', 'fallback_reload.csv');
    csvHandle.loadFile(fallbackFile, null);
    await waitForReadComplete(csvHandle);
    getSheet().df.data[1][0] = 'dirty';
    getSheet().df.isSaved = false;

    // Force reload (force = true) bypasses confirmation prompt and restores fallbackFile
    csvHandle.reloadFile(true);
    await waitForReadComplete(csvHandle);
    assert.deepStrictEqual(getSheet().df.data, [
      ['f1', 'f2'],
      ['100', '200']
    ]);
  });

  await test('View-Only Mode: Files exceeding settings.editMaxFileSize load in locked View-Only sampled mode', async () => {
    const { csvHandle } = createMockTestHarness();
    // Set max editable size to 0.0001 MB (100 bytes) so our test file triggers view-only mode
    settings.editMaxFileSize = 0.0001;
    settings.previewChunks = 2;
    settings.previewRows = 2;

    const lines = ['colA,colB'];
    for (let i = 1; i <= 30; i++) {
      lines.push(`row${i},val${i}`);
    }
    const largeFile = createTestFile(lines.join('\n'), 'large.csv');
    csvHandle.loadFile(largeFile, null);
    await waitForReadComplete(csvHandle);

    assert.strictEqual(csvHandle.viewOnly, true);
    assert.strictEqual(getSheet().df.lock, true);
    assert.strictEqual(getSheet().df.isSaved, true);
    assert.strictEqual(getSheet().df.data[0][0], 'colA');
  });

  await test('Race Condition Guard: Opening File B while File A is mid-stream aborts File A and ignores stale readId chunks', async () => {
    const { csvHandle, worker } = createMockTestHarness();

    // Start manual read #1 (simulating a multi-chunk file in progress)
    csvHandle.readId = 1;
    csvHandle.isFirstChunkLoaded = false;
    csvHandle.isReadComplete = false;

    worker.emitMessage({
      cmd: 'chunk_loaded',
      readId: 1,
      status: 0.5,
      chunk: [['FileA_Col1', 'FileA_Col2'], ['A1', 'A2']],
      chunkId: 1,
      isFirstChunk: true,
      isComplete: false
    });
    assert.deepStrictEqual(getSheet().df.data, [['FileA_Col1', 'FileA_Col2'], ['A1', 'A2']]);

    // Before File A finishes, user opens File B
    const fileB = createTestFile('FileB_H1,FileB_H2\nB1,B2', 'fileB.csv');
    csvHandle.loadFile(fileB, null);
    await waitForReadComplete(csvHandle);

    // Verify 'abort' was sent to the worker for File A
    assert.ok(
      worker.postedCommands.some((c) => c.cmd === 'abort'),
      'Worker should receive an abort command when a new read supersedes an in-flight read'
    );

    // Simulate a late/stale chunk from File A (readId: 1) arriving after File B (readId: 2) loaded
    worker.emitMessage({
      cmd: 'chunk_loaded',
      readId: 1,
      status: 1.0,
      chunk: [['Stale_A3', 'Stale_A4']],
      chunkId: 2,
      isFirstChunk: false,
      isComplete: true
    });

    // File B's data must remain completely uncorrupted!
    assert.deepStrictEqual(getSheet().df.data, [
      ['FileB_H1', 'FileB_H2'],
      ['B1', 'B2']
    ]);
  });

  return { passed, failed };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runFileOpenTests().then((result) => {
    process.exit(result.failed > 0 ? 1 : 0);
  });
}
