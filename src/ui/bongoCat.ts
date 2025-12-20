import type AboutBlank from "src/main";

export class BongoCatManager {
  private plugin: AboutBlank;
  private container: HTMLDivElement | null = null;
  private leftPawState: string = "up";
  private rightPawState: string = "up";
  private keyboardActive: boolean = false;
  private lastPaw: string = "right";
  private dragOffset = { x: 0, y: 0 };

  constructor(plugin: AboutBlank) {
    this.plugin = plugin;
  }

  mount() {
    if (this.container) return;

    const settings = (this.plugin as any).settings || {};

    const container = document.createElement("div");
    container.className = `bongo-cat--Container bongo-cat--Size${this.sizeClass(settings.bongoCatSize || 'medium')}`;
    container.style.position = 'fixed';
    container.style.left = `${settings.bongoCatX ?? 80}%`;
    container.style.top = `${settings.bongoCatY ?? 75}%`;
    container.style.transform = 'translate(-50%, -50%)';
    container.style.zIndex = '9999';
    container.style.background = 'transparent';
    container.style.cursor = 'grab';
    container.title = '点击页面任意位置或按键让猫咪动起来！\n左键/空格/普通键交替击打';

    container.innerHTML = this.svgHtml();

    document.body.appendChild(container);
    this.container = container;

    // inject styles once
    this.injectStyles();

    // events
    const handleMouseDown = (e: MouseEvent) => this.onMouseDown(e);
    const handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    // store reference for cleanup
    (this as any)._listeners = { handleMouseDown, handleKeyDown };
  }

  unmount() {
    if (!this.container) return;
    const settings = (this.plugin as any).settings || {};
    const { handleMouseDown, handleKeyDown } = (this as any)._listeners || {};
    if (handleMouseDown) this.container.removeEventListener('mousedown', handleMouseDown);
    if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown);
    this.container.remove();
    this.container = null;
  }

  toggle() {
    const enabled = !!((this.plugin as any).settings?.bongoCatEnabled);
    (this.plugin as any).settings.bongoCatEnabled = !enabled;
    void (this.plugin as any).saveSettings();
    if (!enabled) this.mount(); else this.unmount();
  }

  sizeClass(size: string) {
    switch (size) {
      case 'small': return 'Small';
      case 'large': return 'Large';
      default: return 'Medium';
    }
  }

  private onMouseDown(e: MouseEvent) {
    if (!this.container) return;
    // start drag
    const rect = this.container.getBoundingClientRect();
    this.dragOffset.x = e.clientX - rect.left;
    this.dragOffset.y = e.clientY - rect.top;
    this.container.style.cursor = 'grabbing';

    const onMove = (ev: MouseEvent) => {
      if (!this.container) return;
      const x = ev.clientX - this.dragOffset.x + rect.width / 2;
      const y = ev.clientY - this.dragOffset.y + rect.height / 2;
      const px = Math.round((x / window.innerWidth) * 100);
      const py = Math.round((y / window.innerHeight) * 100);
      this.container.style.left = `${px}%`;
      this.container.style.top = `${py}%`;
    };

    const onUp = (ev: MouseEvent) => {
      if (!this.container) return;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.container!.style.cursor = 'grab';
      // persist
      const left = parseFloat(this.container!.style.left as string) || 80;
      const top = parseFloat(this.container!.style.top as string) || 75;
      (this.plugin as any).settings.bongoCatX = left;
      (this.plugin as any).settings.bongoCatY = top;
      void (this.plugin as any).saveSettings();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // also treat as click to animate paw
    if (e.button === 0) {
      this.lowerPaw('left');
    } else if (e.button === 2) {
      this.lowerPaw('right');
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    this.keyboardActive = true;
    const container = this.container;
    if (container) {
      container.classList.add('bongo-cat--KeyboardActive');
      setTimeout(() => container.classList.remove('bongo-cat--KeyboardActive'), 150);
    }
    if (this.lastPaw === 'right') {
      this.lowerPaw('left');
      this.lastPaw = 'left';
    } else {
      this.lowerPaw('right');
      this.lastPaw = 'right';
    }
  }

  private raisePaw(paw: 'left' | 'right') {
    if (paw === 'left') {
      this.leftPawState = 'up';
      this.updatePawDom();
    } else {
      this.rightPawState = 'up';
      this.updatePawDom();
    }
  }

  private lowerPaw(paw: 'left' | 'right') {
    if (paw === 'left') {
      this.leftPawState = 'down';
      this.updatePawDom();
      setTimeout(() => this.raisePaw('left'), 150);
    } else {
      this.rightPawState = 'down';
      this.updatePawDom();
      setTimeout(() => this.raisePaw('right'), 150);
    }
  }

  private updatePawDom() {
    if (!this.container) return;
    const upRight = this.container.querySelector('#bongo-cat--paw-right-up');
    const downRight = this.container.querySelector('#bongo-cat--paw-right-down');
    const upLeft = this.container.querySelector('#bongo-cat--paw-left-up');
    const downLeft = this.container.querySelector('#bongo-cat--paw-left-down');
    if (upRight) (upRight as HTMLElement).style.display = this.rightPawState === 'up' ? '' : 'none';
    if (downRight) (downRight as HTMLElement).style.display = this.rightPawState === 'down' ? '' : 'none';
    if (upLeft) (upLeft as HTMLElement).style.display = this.leftPawState === 'up' ? '' : 'none';
    if (downLeft) (downLeft as HTMLElement).style.display = this.leftPawState === 'down' ? '' : 'none';
  }

  private injectStyles() {
    if (document.getElementById('bongo-cat--styles')) return;
    const style = document.createElement('style');
    style.id = 'bongo-cat--styles';
    style.textContent = `
.bongo-cat--Container { user-select:none; }
.bongo-cat--Container svg{display:block}
.bongo-cat--SizeSmall svg{height:8vh;width:10vw}
.bongo-cat--SizeMedium svg{height:13vh;width:15vw}
.bongo-cat--SizeLarge svg{height:20vh;width:22vw}
.bongo-cat--typing-animation{animation-timing-function:linear;animation-iteration-count:infinite;animation-duration:1200ms}
/* simplified paw transition */
#bongo-cat--paw-right-up,#bongo-cat--paw-left-up,#bongo-cat--paw-right-down,#bongo-cat--paw-left-down{transition:transform .075s ease-out}
#bongo-cat--paw-right-down,#bongo-cat--paw-left-down{transform:translateY(4px)}
.bongo-cat--KeyboardActive #bongo-cat--laptop-keyboard{filter:brightness(1.2);transition:filter .075s ease}
.bongo-cat--KeyboardActive #bongo-cat--laptop-keyboard polygon{fill:var(--interactive-accent) !important}
/* ensure transparent background */
.bongo-cat--Container{background:transparent}
`;
    document.head.appendChild(style);
  }

  private svgHtml(): string {
    // The inner SVG is taken from the provided component (trimmed to essentials).
    return `
<svg id="bongo-cat" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 787.3 433.8">
  <defs>
    <symbol id="bongo-cat--eye" viewBox="0 0 19.2 18.7"><circle cx="9.4" cy="9.1" r="8"></circle></symbol>
    <symbol id="bongo-cat--paw-pads" viewBox="0 0 31.4 33.9"><path fill="#ef97b0" d="M6.8,16a3.7,3.7,0,0,1,1.1,2.8,3.2,3.2,0,0,1-1.6,2.6L5,21.8H4.4a2.8,2.8,0,0,1-1.8.3A4.2,4.2,0,0,1,.2,19.1,7.7,7.7,0,0,1,0,17.6a2.8,2.8,0,0,1,.6-2,3.2,3.2,0,0,1,2.1-.8H4A5,5,0,0,1,6.8,16Z"></path></symbol>
  </defs>
  <!-- simplified: head, laptop, paws -->
  <g id="bongo-cat--laptop">
    <g id="bongo-cat--laptop-keyboard"><polygon points="371.1 274.8 256.8 253.5 257 252.7 266.2 251.1 382.4 271.5" fill="#3e3e54"></polygon></g>
    <!-- right paw up -->
    <g id="bongo-cat--paw-right-up">
      <g><path d="M282.2,215.2c-1.6-1.6-12.8-17.9-14-34.3-.1-2.5,1.7-16,12.9-22.4s22.3-1.9,26.2.4c12.2,7.3,21.2,19.1,22.8,22.4" fill="#fff"></path></g>
      <use width="31.4" height="33.93" transform="translate(273.2 166.1) rotate(-5.6)" xlink:href="#bongo-cat--paw-pads"></use>
    </g>
    <g id="bongo-cat--paw-right-down" style="display:none"><path d="M293.2,191.3l10-7s-18.4,11.1-24,20-13,20.4-9,31c4.7,12.4,20.5,15.7,22,16" fill="#fff"></path></g>
    <!-- left paw -->
    <g id="bongo-cat--paw-left-up"><g><path d="M545.4,261.9c-7.1-13-12.9-31.1-13.3-37.6-.6-9,0-15.6,5.2-22.2s15-9.8,22.7-8.8a26.7,26.7,0,0,1,17.3,9.4c5.3,5.8,9.4,12.9,11.6,16.6" fill="#fff"></path></g>
      <use width="31.4" height="33.93" transform="matrix(0.99, -0.03, 0.04, 1, 539.85, 203.52)" xlink:href="#bongo-cat--paw-pads"></use>
    </g>
    <g id="bongo-cat--paw-left-down" style="display:none"><path d="M538.2,239.3c-3.2,1.6-33,10.8-37,28-.4,1.8-2.1,18.9,7,26" fill="#fff"></path></g>
  </g>
</svg>
`;
  }
}

export default BongoCatManager;
