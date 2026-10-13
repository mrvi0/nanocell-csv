import { cmd } from '../interaction/CommandRegistry.js';
import { getSheet } from '../appContext.js';

class ContextMenu extends HTMLElement {
  constructor() {
    super();
    this.table = document.createElement('table');
    this.firstBlock = document.createElement('div');
    this.firstBlock.className = 'cmenu_header';
    this.targetCol = null;

    this.list = [
      { key: 'fl', txt: 'Filter', opt: '', run: () => cmd.filter?.run(this.targetCol) },
      { key: 'sa', txt: 'Sort', opt: 'A<br>Z', run: (e) => cmd.sort?.run(e) },
      { key: 'sd', txt: 'Sort', opt: 'Z<br>A', run: (e) => cmd.sort_reverse?.run(e) },
      { key: 'rn', txt: 'Round', opt: 'N', run: (e) => cmd.integer?.run(e) },
      { key: 'rf', txt: 'Round', opt: '$', run: (e) => cmd.decimal?.run(e) },
      { key: 'ic', txt: 'Insert', opt: '&verbar;', run: (e) => cmd.insertLeft?.run(e) },
      { key: 'ir', txt: 'Insert', opt: '&horbar;', run: (e) => cmd.insertUp?.run(e) },
      { key: 'dc', txt: 'Delete', opt: '&verbar;', run: (e) => cmd.deleteCol?.run(e) },
      { key: 'dr', txt: 'Delete', opt: '&horbar;', run: (e) => cmd.deleteRow?.run(e) },
    ];

    this.addEventListener('mouseout', (event) => {
      if (!this.contains(event.relatedTarget)) this.hide();
    });
  }

  hide() {
    this.classList.remove('open', 'visible');
    this.removeAttribute('open');
    this.style.display = 'none';
  }

  ensureInitialized() {
    if (this._menuInitialized) return;
    this._menuInitialized = true;
    this.table.innerHTML = '';
    for (const item of this.list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><div>${item.txt}</div></td>${item.opt ? `<td><div class="cmenu_opt">${item.opt}</div></td>` : ''}`;
      tr.addEventListener('click', (ev) => {
        this.hide();
        item.run(ev);
      });
      this.table.appendChild(tr);
    }
    if (!this.firstBlock.parentNode) {
      this.appendChild(this.firstBlock);
      this.appendChild(this.table);
    }
  }

  connectedCallback() {
    this.hide();
    this.ensureInitialized();
  }

  showItems(showList) {
    for (let i = 0; i < this.list.length; i++) {
      const isVisible = showList.includes(this.list[i].key);
      this.table.rows[i].classList.toggle('hidden', !isVisible);
      this.table.rows[i].style.display = isVisible ? 'table-row' : 'none';
    }
  }

  pop(e) {
    this.ensureInitialized();
    const sheet = getSheet();
    const targetCell = e.target.closest?.('td, th');
    if (!sheet || !targetCell || !sheet.contains(targetCell) || (targetCell.tx < 0 && targetCell.ty < 0)) return;

    this.x = targetCell.tx;
    this.y = targetCell.ty;

    const menuWidth = 140;
    const menuHeight = 220;
    const x = (typeof window !== 'undefined' && e.clientX + menuWidth > window.innerWidth)
      ? Math.max(0, e.clientX - menuWidth)
      : e.clientX - 2;
    const y = (typeof window !== 'undefined' && e.clientY + menuHeight > window.innerHeight)
      ? Math.max(0, e.clientY - menuHeight)
      : e.clientY - 2;
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;

    if (this.y < 0) {
      this.targetCol = this.x + sheet.baseX;
      sheet.slctCol(this.targetCol);
      this.firstBlock.innerText = `col : ${targetCell.innerText}`;
      this.showItems(['fl', 'sa', 'sd', 'rn', 'rf', 'ic', 'dc']);
    } else if (this.x < 0) {
      this.targetCol = null;
      sheet.slctRow(this.y + sheet.baseY);
      this.firstBlock.innerText = `row : ${targetCell.innerText}`;
      this.showItems(['rn', 'rf', 'ir', 'dr']);
    } else if (targetCell.classList.contains('slct')) {
      this.targetCol = null;
      this.firstBlock.innerText = 'selection';
      this.showItems(['rn', 'rf', 'dc', 'dr']);
    } else {
      this.targetCol = targetCell.tx + sheet.baseX;
      sheet.x = targetCell.tx + sheet.baseX;
      sheet.y = targetCell.ty + sheet.baseY;
      sheet.slctRefresh();
      this.firstBlock.innerText = 'cell';
      this.showItems(['rn', 'rf', 'ic', 'ir', 'dc', 'dr']);
    }

    this.classList.add('open', 'visible');
    this.setAttribute('open', '');
    this.style.display = 'block';
  }
}

if (!customElements.get('ui-cmenu')) {
  customElements.define('ui-cmenu', ContextMenu);
}

export { ContextMenu };
