import { getSheet, getCsvHandle } from '../appContext.js';
import { Setting, SettingDialog } from '../ui/settings/Setting.js';
import { AboutDialog } from '../ui/AboutDialog.js';
import { CommandPalette } from '../ui/CommandPalette.js';
import { formatShortcut } from '../utils/misc.js';
import { triggerAppInstall } from '../ui/Notification.js';

const cmd = {
  about: { label: 'About', k: 'H', ctrl: true, run: () => AboutDialog.show(), description: 'About' },
  installApp: { label: 'Install Desktop App', run: () => triggerAppInstall(), description: 'Install NanoCell as standalone desktop app' },
  new: { label: 'New Sheet', k: 'N', ctrl: true, run: () => getCsvHandle()?.new(), description: 'New sheet' },
  deleteRow: { label: 'Delete Row', k: 'BACKSPACE', ctrl: true, run: () => getSheet()?.deleteRows(), description: 'Delete Row' },
  deleteCol: { label: 'Delete Col', k: 'BACKSPACE', ctrl: true, shift: true, run: () => getSheet()?.deleteCols(), description: 'Delete Col' },
  delete: { label: 'Delete Selection', k: 'BACKSPACE', run: () => getSheet()?.deleteSelection(), description: 'Delete Selection' },
  settings: { label: 'Settings', k: 'G', ctrl: true, run: () => SettingDialog.show(), description: 'Display Settings' },
  shortcuts: { label: 'Command Palette', k: 'P', ctrl: true, run: () => CommandPalette.toggle(cmd), description: 'Command Palette' },
  slctAll: { label: 'Select All', k: 'A', ctrl: true, run: () => getSheet()?.slctAll(), description: 'Select All' },
  transpose: { label: 'Transpose', k: 'T', ctrl: true, shift: true, run: () => getSheet()?.rangeTranspose(), description: 'Transpose rows and columns (selection or whole sheet)' },
  trim: { label: 'Trim Empty Rows/Cols', k: 'T', ctrl: true, alt: true, run: () => getSheet()?.trim(), description: 'Trim : remove all empty rows/cols' },
  integer: { label: 'Round to Integer', k: 'I', ctrl: true, run: () => getSheet()?.round(true), description: 'Round selection to integer' },
  decimal: { label: 'Round to Decimal', k: '$', ctrl: true, run: () => getSheet()?.round(false), description: 'Round selection to decimal' },
  fixTop: { label: 'Freeze Header Row', k: 'B', ctrl: true, run: () => getSheet()?.toggleFixTop(), description: 'Freeze Header Row' },
  undo: { label: 'Undo', k: 'Z', ctrl: true, run: () => getSheet()?.undo(), description: 'Undo' },
  redo: { label: 'Redo', k: 'Z', ctrl: true, shift: true, run: () => getSheet()?.redo(), description: 'Redo' },
  date: { label: "Insert Today's Date", k: ';', ctrl: true, run: () => getSheet()?.insertDate(), description: "Insert today's date" },
  validate_dates: { label: 'Validate: Date Formats (YYYY-MM-DD)', run: () => getSheet()?.validate_rule('dates'), description: 'Standardize date formats across columns to YYYY-mm-dd' },
  validate_whitespace: { label: 'Validate: Trim Whitespace', run: () => getSheet()?.validate_rule('trim_whitespace'), description: 'Remove leading and trailing whitespace from cell text' },
  validate_comma_num: { label: 'Validate: Decimal Comma -> Dot', run: () => getSheet()?.validate_rule('comma_decimals'), description: 'Convert comma decimals (3,14) to dot notation in numeric fields' },
  validate_line_returns: { label: 'Validate: Line Returns -> Pipe', run: () => getSheet()?.validate_rule('line_returns'), description: 'Replace embedded newline line breaks with pipe character (|)' },
  validate_quotes: { label: 'Validate: Double Quotes -> Single', run: () => getSheet()?.validate_rule('double_quotes'), description: 'Replace double quotation marks (") with single quotes (\')' },
  validate_comma_text: { label: 'Validate: Text Commas -> Dash', run: () => getSheet()?.validate_rule('text_commas'), description: 'Replace commas inside text cells with hyphens (-)' },
  validate_lower: { label: 'Validate: Force Lowercase', run: () => getSheet()?.validate_rule('lowercase'), description: 'Convert all text cells to lowercase' },
  filter: { label: 'Filter Column', k: 'Q', ctrl: true, run: (col) => getSheet()?.openFilter(col), description: 'Filter sheet rows by column value' },
  find: { label: 'Find & Match', k: 'F', ctrl: true, run: () => getSheet()?.find(false), description: 'Quick find / match' },
  findAdvanced: { label: 'Advanced Find / Replace', k: 'F', ctrl: true, shift: true, run: () => getSheet()?.find(true), description: 'Advanced find / replace (work in progress)' },
  menubar: { label: 'Toggle Menu Bar', k: 'M', ctrl: true, run: () => Setting.toggleActionBar(), description: 'Toggle action bar display' },
  open: { label: 'Open File', k: 'O', ctrl: true, run: () => getCsvHandle()?.open(), description: 'Open a CSV file from the file finder' },
  save: { label: 'Save', k: 'S', ctrl: true, run: () => getCsvHandle()?.save(), description: 'Save' },
  saveAs: { label: 'Save As', k: 'S', ctrl: true, shift: true, run: () => getCsvHandle()?.saveAs(), description: 'Save As' },
  reloadFile: { label: 'Reload File', k: 'R', ctrl: true, run: () => getCsvHandle()?.reloadFile(), description: 'Reload file from last save' },
  expand: { label: 'Expand Row', k: 'E', ctrl: true, run: () => getSheet()?.expand(), description: 'Expand first row to selection' },
  validate_data: { label: 'Validate Data: Open Pane', k: 'P', ctrl: true, shift: true, run: () => getSheet()?.open_validation_pane(), description: 'Open data validation pane with all validation rules' },
  validate_headers: { label: 'Validate: Headers & SQL Compliance', k: 'H', ctrl: true, shift: true, run: () => getSheet()?.validate_rule('headers'), description: 'Validate and sanitize column headers for SQL identifier standards and duplicates' },
  next_occurance: { label: 'Next Occurrence', k: 'D', ctrl: true, run: () => getSheet()?.go_to_next(), description: 'Go to next occurence of cell value' },
  prev_occurance: { label: 'Previous Occurrence', k: 'D', ctrl: true, shift: true, run: () => getSheet()?.go_to_prev(), description: 'Go to previous occurence of cell value' },
  goToCoordinate: { label: 'Go to Coordinate', run: () => getSheet()?.startCoordEdit(), description: 'Go to coordinate' },
  sort: { label: 'Sort Ascending', k: 'L', ctrl: true, run: () => getSheet()?.sortAscending(), description: 'Sort rows based on active column (ascending order)' },
  sort_reverse: { label: 'Sort Descending', k: 'L', ctrl: true, shift: true, run: () => getSheet()?.sortDescending(), description: 'Sort rows based on active column (descending order)' },
  shiftUp: { label: 'Shift Row Up', k: 'ARROWUP', alt: true, run: () => getSheet()?.shift(0), description: 'Shift row up' },
  shiftDown: { label: 'Shift Row Down', k: 'ARROWDOWN', alt: true, run: () => getSheet()?.shift(2), description: 'Shift row down' },
  shiftRight: { label: 'Shift Col Right', k: 'ARROWRIGHT', alt: true, run: () => getSheet()?.shift(1), description: 'Shift col right' },
  shiftLeft: { label: 'Shift Col Left', k: 'ARROWLEFT', alt: true, run: () => getSheet()?.shift(3), description: 'Shift col left' },
  insertUp: { label: 'Insert Row Above', k: 'ARROWUP', shift: true, alt: true, run: () => getSheet()?.insert(0), description: 'Insert row above' },
  insertDown: { label: 'Insert Row Below', k: 'ARROWDOWN', shift: true, alt: true, run: () => getSheet()?.insert(2), description: 'Insert row below' },
  insertRight: { label: 'Insert Col Right', k: 'ARROWRIGHT', shift: true, alt: true, run: () => getSheet()?.insert(1), description: 'Insert col right' },
  insertLeft: { label: 'Insert Col Left', k: 'ARROWLEFT', shift: true, alt: true, run: () => getSheet()?.insert(3), description: 'Insert col left' },
  exportJson: { label: 'Export as JSON', run: () => getCsvHandle()?.exportJson(), description: 'Export current sheet as JSON file' },
  exportTsv: { label: 'Export as TSV', run: () => getCsvHandle()?.exportTsv(), description: 'Export current sheet as Tab-Separated Values (TSV) file' },
  exportMarkdown: { label: 'Export as Markdown', run: () => getCsvHandle()?.exportMarkdown(), description: 'Export current sheet as GitHub Flavored Markdown table' },
  copyMarkdown: { label: 'Copy as Markdown', run: () => getCsvHandle()?.copyMarkdown(), description: 'Copy active selection as Markdown table to clipboard' },
  copyJson: { label: 'Copy as JSON', run: () => getCsvHandle()?.copyJson(), description: 'Copy active selection as JSON to clipboard' },
};

CommandPalette.setDefaultCommands(cmd);

export function getCommandTooltip(c, fallbackKey = '') {
  if (!c) return fallbackKey;
  const shortcut = formatShortcut(c);
  const name = c.label || c.description || fallbackKey;
  return shortcut ? `${name} (${shortcut})` : name;
}

export { cmd, formatShortcut };
