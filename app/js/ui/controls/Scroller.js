const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class Scroller extends BaseElement {
  constructor(vertical = true) {
    super();
    this.vertical = vertical;
    this.classList?.add(vertical ? "vertical" : "horizontal");
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ui-scroller')) {
  customElements.define('ui-scroller', Scroller);
}

export { Scroller };
