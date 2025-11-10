import { CaveGenParams, DEFAULT_CAVE_PARAMS } from './BubbleGenerator';

/**
 * UI for cave generation parameters
 */
export class CaveGeneratorUI {
  private container: HTMLDivElement;
  private isVisible = false;
  private toggleButton: HTMLButtonElement;

  // Current parameters
  public params: CaveGenParams;

  // Callback for when generate button is clicked
  public onGenerate?: (params: CaveGenParams) => void;

  constructor() {
    // Initialize with defaults
    this.params = { ...DEFAULT_CAVE_PARAMS };

    // Create UI elements
    this.container = this.createContainer();
    this.toggleButton = this.createToggleButton();

    document.body.appendChild(this.container);
    document.body.appendChild(this.toggleButton);
  }

  private createToggleButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = 'cave-generator-button';
    button.title = 'Cave Generator';
    button.textContent = '🏔️';
    button.style.cssText = `
      position: fixed;
      bottom: calc(env(safe-area-inset-bottom, 10px) + 10px);
      left: calc(env(safe-area-inset-left, 10px) + 270px);
      background: rgba(76, 175, 80, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 50%;
      width: 48px;
      height: 48px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
      pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      -webkit-tap-highlight-color: rgba(76, 175, 80, 0.3);
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
    `;
    button.addEventListener('click', () => this.toggle());
    return button;
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'cave-generator-ui';
    container.style.cssText = `
      position: fixed;
      top: calc(env(safe-area-inset-top, 10px) + 60px);
      left: 10px;
      width: 320px;
      max-height: calc(90vh - env(safe-area-inset-top, 10px) - 70px);
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(76, 175, 80, 0.3);
      border-radius: 4px;
      z-index: 10000;
      display: none;
      flex-direction: column;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      pointer-events: auto;
      backdrop-filter: blur(2px);
      overflow-y: auto;
    `;

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      background: rgba(76, 175, 80, 0.1);
      color: #4CAF50;
      padding: 6px 8px;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 3px 3px 0 0;
      position: sticky;
      top: 0;
      z-index: 1;
    `;

    const title = document.createElement('div');
    title.textContent = '🏔️ Cave Generator';
    title.style.cssText = 'font-weight: bold;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #4CAF50;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 6px;
      opacity: 0.6;
    `;
    closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.6';
    closeBtn.onclick = () => this.toggle();

    titleBar.appendChild(title);
    titleBar.appendChild(closeBtn);
    container.appendChild(titleBar);

    // Content
    const content = document.createElement('div');
    content.style.cssText = `
      padding: 10px;
      color: rgba(255, 255, 255, 0.9);
      overflow-y: auto;
    `;

    // Add parameter sections
    content.appendChild(this.createSection('Distribution', [
      this.createSlider('Bubble Count', 'bubbleCount', 5, 100, 1, (v) => Math.round(v)),
      this.createSlider('Clusteriness', 'clusteriness', 0, 1, 0.01),
      this.createSlider('Cluster Scale (m)', 'clusterScale', 3, 15, 0.5),
    ]));

    content.appendChild(this.createSection('Size', [
      this.createSlider('Min Size (m)', 'sizeMin', 0.5, 5, 0.1),
      this.createSlider('Max Size (m)', 'sizeMax', 2, 10, 0.1),
      this.createDropdown('Distribution', 'sizeDistribution', [
        { value: 'uniform', label: 'Uniform' },
        { value: 'powerLaw', label: 'Power Law (natural)' },
        { value: 'normal', label: 'Normal' }
      ]),
    ]));

    content.appendChild(this.createSection('Shape', [
      this.createSlider('Complexity', 'shapeComplexity', 1, 4, 1, (v) => Math.round(v)),
      this.createSlider('Irregularity', 'shapeIrregularity', 0, 1, 0.01),
      this.createSlider('Angular Freq', 'shapeAngularFreq', 2, 12, 0.5),
      this.createSlider('Variation', 'shapeVariation', 0, 1, 0.01),
    ]));

    content.appendChild(this.createSection('Overlap', [
      this.createSlider('Overlap Chance', 'overlapChance', 0, 1, 0.01),
      this.createSlider('Separation (m)', 'separationWhenNoOverlap', 0.2, 3, 0.1),
    ]));

    content.appendChild(this.createSection('Blending', [
      this.createSlider('Soft K', 'softK', 0.3, 3, 0.1),
    ]));

    // Generate button
    const generateBtn = document.createElement('button');
    generateBtn.textContent = '🎲 Generate New Cave';
    generateBtn.style.cssText = `
      width: 100%;
      padding: 12px;
      margin-top: 10px;
      background: rgba(76, 175, 80, 0.3);
      border: 1px solid rgba(76, 175, 80, 0.5);
      border-radius: 4px;
      color: #4CAF50;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.2s;
    `;
    generateBtn.onmouseenter = () => {
      generateBtn.style.background = 'rgba(76, 175, 80, 0.5)';
    };
    generateBtn.onmouseleave = () => {
      generateBtn.style.background = 'rgba(76, 175, 80, 0.3)';
    };
    generateBtn.onclick = () => {
      // Generate new seed
      this.params.seed = Date.now();
      if (this.onGenerate) {
        this.onGenerate(this.params);
      }
    };
    content.appendChild(generateBtn);

    container.appendChild(content);
    return container;
  }

  private createSection(title: string, controls: HTMLElement[]): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(76, 175, 80, 0.2);
    `;

    const sectionTitle = document.createElement('div');
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      color: #4CAF50;
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 11px;
    `;
    section.appendChild(sectionTitle);

    controls.forEach(control => section.appendChild(control));
    return section;
  }

  private createSlider(
    label: string,
    param: keyof CaveGenParams,
    min: number,
    max: number,
    step: number,
    transform?: (v: number) => number
  ): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 8px;';

    const labelEl = document.createElement('label');
    labelEl.style.cssText = `
      display: flex;
      justify-content: space-between;
      margin-bottom: 2px;
      font-size: 10px;
    `;

    const labelText = document.createElement('span');
    labelText.textContent = label;

    const valueDisplay = document.createElement('span');
    valueDisplay.style.cssText = 'color: #4CAF50; font-weight: bold;';

    const currentValue = this.params[param] as number;
    valueDisplay.textContent = transform ? transform(currentValue).toFixed(2) : currentValue.toFixed(2);

    labelEl.appendChild(labelText);
    labelEl.appendChild(valueDisplay);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min.toString();
    slider.max = max.toString();
    slider.step = step.toString();
    slider.value = currentValue.toString();
    slider.style.cssText = `
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: rgba(76, 175, 80, 0.2);
      outline: none;
      -webkit-appearance: none;
    `;

    // Slider thumb styling
    const style = document.createElement('style');
    style.textContent = `
      #cave-generator-ui input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #4CAF50;
        cursor: pointer;
      }
      #cave-generator-ui input[type="range"]::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #4CAF50;
        cursor: pointer;
        border: none;
      }
    `;
    if (!document.getElementById('cave-gen-slider-style')) {
      style.id = 'cave-gen-slider-style';
      document.head.appendChild(style);
    }

    slider.oninput = () => {
      const value = parseFloat(slider.value);
      const finalValue = transform ? transform(value) : value;
      (this.params[param] as number) = finalValue;
      valueDisplay.textContent = finalValue.toFixed(2);
    };

    container.appendChild(labelEl);
    container.appendChild(slider);
    return container;
  }

  private createDropdown(
    label: string,
    param: keyof CaveGenParams,
    options: Array<{ value: string; label: string }>
  ): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 8px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `
      display: block;
      margin-bottom: 4px;
      font-size: 10px;
    `;

    const select = document.createElement('select');
    select.style.cssText = `
      width: 100%;
      padding: 4px;
      background: rgba(76, 175, 80, 0.1);
      border: 1px solid rgba(76, 175, 80, 0.3);
      border-radius: 3px;
      color: #4CAF50;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      cursor: pointer;
    `;

    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (this.params[param] === opt.value) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.onchange = () => {
      (this.params[param] as string) = select.value;
    };

    container.appendChild(labelEl);
    container.appendChild(select);
    return container;
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'flex' : 'none';
  }

  public show(): void {
    this.isVisible = true;
    this.container.style.display = 'flex';
  }

  public hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
  }
}
