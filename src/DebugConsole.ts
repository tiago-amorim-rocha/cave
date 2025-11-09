/**
 * Debug console for displaying logs on-screen
 */
export class DebugConsole {
  private container: HTMLDivElement;
  private logContainer: HTMLDivElement;
  private controlsContainer: HTMLDivElement;
  private isVisible = true; // Always visible in lightweight mode
  private logs: string[] = [];
  private maxLogs = 100;

  // Toggle callbacks
  public onToggleControlMode?: (enabled: boolean) => void;
  public onTogglePhysicsMesh?: (enabled: boolean) => void;
  public onToggleOptimizedVertices?: (enabled: boolean) => void;
  public onToggleOriginalVertices?: (enabled: boolean) => void;
  public onToggleGrid?: (enabled: boolean) => void;
  public onToggleDensityField?: (enabled: boolean) => void;
  public onSimplificationChange?: (epsilon: number) => void;
  public onSimplificationPostChange?: (epsilon: number) => void;
  public onToggleChaikin?: (enabled: boolean) => void;
  public onChaikinIterationsChange?: (iterations: number) => void;
  public onToggleISOSnappingPost?: (enabled: boolean) => void;

  constructor() {
    this.container = this.createContainer();
    this.controlsContainer = this.createControlsContainer();
    this.logContainer = this.createLogContainer();
    this.container.appendChild(this.controlsContainer);
    this.container.appendChild(this.logContainer);
    document.body.appendChild(this.container);

    // Intercept console methods
    this.interceptConsole();
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'debug-console';
    container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 140px;
      max-height: 90vh;
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(76, 175, 80, 0.3);
      border-radius: 4px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      pointer-events: auto;
      backdrop-filter: blur(2px);
    `;

    // Minimal title bar (just for controls, no title text)
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      background: rgba(76, 175, 80, 0.1);
      color: #4CAF50;
      padding: 4px 6px;
      font-size: 9px;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      border-radius: 3px 3px 0 0;
    `;

    // Button container for copy and close buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 4px;
      align-items: center;
    `;

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.style.cssText = `
      background: none;
      border: none;
      color: #4CAF50;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 4px;
      opacity: 0.6;
    `;
    copyBtn.title = 'Copy logs to clipboard';
    copyBtn.onmouseenter = () => copyBtn.style.opacity = '1';
    copyBtn.onmouseleave = () => copyBtn.style.opacity = '0.6';
    copyBtn.onclick = () => this.copyLogs();
    buttonContainer.appendChild(copyBtn);

    titleBar.appendChild(buttonContainer);
    container.appendChild(titleBar);

    return container;
  }

  private createControlsContainer(): HTMLDivElement {
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
      background: rgba(0, 0, 0, 0.1);
      padding: 8px;
      border-bottom: 1px solid rgba(76, 175, 80, 0.2);
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = 'Debug';
    title.style.cssText = `
      color: #4CAF50;
      font-weight: bold;
      font-size: 9px;
      margin-bottom: 2px;
      opacity: 0.7;
    `;
    controlsContainer.appendChild(title);

    // Create toggles
    const toggles = [
      { label: 'Character Control', key: 'controlmode', callback: 'onToggleControlMode', checked: true },
      { label: 'Physics Mesh', key: 'physics', callback: 'onTogglePhysicsMesh', checked: false },
      { label: 'Optimized Vertices', key: 'optimized', callback: 'onToggleOptimizedVertices', checked: false },
      { label: 'Original Vertices', key: 'original', callback: 'onToggleOriginalVertices', checked: false },
      { label: 'Grid', key: 'grid', callback: 'onToggleGrid', checked: false },
      { label: 'Density Field', key: 'density', callback: 'onToggleDensityField', checked: false },
      { label: 'ISO-Snap (Post)', key: 'isosnappost', callback: 'onToggleISOSnappingPost', checked: true }
    ];

    toggles.forEach(({ label, key, callback, checked }) => {
      const toggleRow = document.createElement('div');
      toggleRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `debug-${key}`;
      checkbox.checked = checked || false;
      checkbox.style.cssText = `
        cursor: pointer;
        width: 12px;
        height: 12px;
      `;

      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const callbackName = callback as keyof DebugConsole;
        const fn = this[callbackName];
        if (typeof fn === 'function') {
          (fn as (enabled: boolean) => void).call(this, target.checked);
        }
      });

      const labelEl = document.createElement('label');
      labelEl.htmlFor = `debug-${key}`;
      labelEl.textContent = label;
      labelEl.style.cssText = `
        color: #4CAF50;
        cursor: pointer;
        user-select: none;
      `;

      toggleRow.appendChild(checkbox);
      toggleRow.appendChild(labelEl);
      controlsContainer.appendChild(toggleRow);
    });

    // Add stats display
    const statsRow = document.createElement('div');
    statsRow.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 8px;
      padding: 6px;
      background: rgba(76, 175, 80, 0.05);
      border-radius: 3px;
      border: 1px solid rgba(76, 175, 80, 0.2);
    `;

    const statsTitle = document.createElement('div');
    statsTitle.style.cssText = `
      color: #4CAF50;
      font-size: 9px;
      font-weight: bold;
      margin-bottom: 3px;
      opacity: 0.8;
    `;
    statsTitle.textContent = 'Vertex Optimization';

    const statsOriginal = document.createElement('div');
    statsOriginal.style.cssText = `
      color: #4CAF50;
      font-size: 8px;
      display: flex;
      justify-content: space-between;
    `;
    statsOriginal.innerHTML = '<span>Original:</span><span id="stats-original">—</span>';

    const statsFinal = document.createElement('div');
    statsFinal.style.cssText = `
      color: #4CAF50;
      font-size: 8px;
      display: flex;
      justify-content: space-between;
    `;
    statsFinal.innerHTML = '<span>Final:</span><span id="stats-final">—</span>';

    const statsReduction = document.createElement('div');
    statsReduction.style.cssText = `
      color: #4CAF50;
      font-size: 8px;
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      margin-top: 2px;
      padding-top: 3px;
      border-top: 1px solid rgba(76, 175, 80, 0.2);
    `;
    statsReduction.innerHTML = '<span>Reduction:</span><span id="stats-reduction">—</span>';

    statsRow.appendChild(statsTitle);
    statsRow.appendChild(statsOriginal);
    statsRow.appendChild(statsFinal);
    statsRow.appendChild(statsReduction);
    controlsContainer.appendChild(statsRow);

    // Add Douglas-Peucker simplification slider
    const sliderRow = document.createElement('div');
    sliderRow.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(76, 175, 80, 0.2);
    `;

    const sliderLabel = document.createElement('div');
    sliderLabel.style.cssText = `
      color: #4CAF50;
      font-size: 9px;
      display: flex;
      justify-content: space-between;
      opacity: 0.8;
    `;
    sliderLabel.innerHTML = '<span>Simplification (ε)</span><span id="epsilon-value">0.000m <span id="epsilon-reduction" style="opacity: 0.6;"></span></span>';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'simplification-slider';
    slider.min = '0';
    slider.max = '83';
    slider.value = '0';
    slider.step = '1';
    slider.style.cssText = `
      width: 100%;
      cursor: pointer;
    `;

    slider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const value = parseInt(target.value);
      // Map 0-83 to 0-0.755m exponentially for finer control at low values
      const epsilon = value === 0 ? 0 : Math.pow(value / 100, 1.5);
      const epsilonDisplay = document.getElementById('epsilon-value');
      if (epsilonDisplay) {
        epsilonDisplay.textContent = `${epsilon.toFixed(3)}m`;
      }
      if (this.onSimplificationChange) {
        this.onSimplificationChange(epsilon);
      }
    });

    const sliderDesc = document.createElement('div');
    sliderDesc.style.cssText = `
      color: rgba(76, 175, 80, 0.5);
      font-size: 8px;
      margin-top: 1px;
    `;
    sliderDesc.textContent = 'VW simplification';

    sliderRow.appendChild(sliderLabel);
    sliderRow.appendChild(slider);
    sliderRow.appendChild(sliderDesc);
    controlsContainer.appendChild(sliderRow);

    // Add post-smoothing simplification slider
    const sliderRowPost = document.createElement('div');
    sliderRowPost.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(76, 175, 80, 0.2);
    `;

    const sliderLabelPost = document.createElement('div');
    sliderLabelPost.style.cssText = `
      color: #4CAF50;
      font-size: 9px;
      display: flex;
      justify-content: space-between;
      opacity: 0.8;
    `;
    sliderLabelPost.innerHTML = '<span>Post-Smoothing (ε)</span><span id="epsilon-post-value">0.000m <span id="epsilon-post-reduction" style="opacity: 0.6;"></span></span>';

    const sliderPost = document.createElement('input');
    sliderPost.type = 'range';
    sliderPost.id = 'simplification-post-slider';
    sliderPost.min = '0';
    sliderPost.max = '83';
    sliderPost.value = '0';
    sliderPost.step = '1';
    sliderPost.style.cssText = `
      width: 100%;
      cursor: pointer;
    `;

    sliderPost.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const value = parseInt(target.value);
      // Map 0-83 to 0-0.755m exponentially for finer control at low values
      const epsilon = value === 0 ? 0 : Math.pow(value / 100, 1.5);
      const epsilonDisplay = document.getElementById('epsilon-post-value');
      if (epsilonDisplay) {
        epsilonDisplay.textContent = `${epsilon.toFixed(3)}m`;
      }
      if (this.onSimplificationPostChange) {
        this.onSimplificationPostChange(epsilon);
      }
    });

    const sliderDescPost = document.createElement('div');
    sliderDescPost.style.cssText = `
      color: rgba(76, 175, 80, 0.5);
      font-size: 8px;
      margin-top: 1px;
    `;
    sliderDescPost.textContent = 'Remove Chaikin redundancy';

    sliderRowPost.appendChild(sliderLabelPost);
    sliderRowPost.appendChild(sliderPost);
    sliderRowPost.appendChild(sliderDescPost);
    controlsContainer.appendChild(sliderRowPost);

    // Add Chaikin smoothing controls
    const chaikinSection = document.createElement('div');
    chaikinSection.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(76, 175, 80, 0.2);
    `;

    // Chaikin toggle
    const chaikinToggleRow = document.createElement('div');
    chaikinToggleRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    const chaikinCheckbox = document.createElement('input');
    chaikinCheckbox.type = 'checkbox';
    chaikinCheckbox.id = 'chaikin-toggle';
    chaikinCheckbox.style.cssText = `
      cursor: pointer;
      width: 12px;
      height: 12px;
    `;

    chaikinCheckbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (this.onToggleChaikin) {
        this.onToggleChaikin(target.checked);
      }
    });

    const chaikinLabel = document.createElement('label');
    chaikinLabel.htmlFor = 'chaikin-toggle';
    chaikinLabel.textContent = 'Chaikin Smoothing';
    chaikinLabel.style.cssText = `
      color: #4CAF50;
      cursor: pointer;
      user-select: none;
      font-size: 10px;
    `;

    chaikinToggleRow.appendChild(chaikinCheckbox);
    chaikinToggleRow.appendChild(chaikinLabel);
    chaikinSection.appendChild(chaikinToggleRow);

    // Chaikin iterations slider
    const iterationsRow = document.createElement('div');
    iterationsRow.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 3px;
    `;

    const iterationsLabel = document.createElement('div');
    iterationsLabel.style.cssText = `
      color: #4CAF50;
      font-size: 9px;
      display: flex;
      justify-content: space-between;
      opacity: 0.8;
    `;
    iterationsLabel.innerHTML = '<span>Iterations</span><span id="chaikin-iterations-value">1</span>';

    const iterationsSlider = document.createElement('input');
    iterationsSlider.type = 'range';
    iterationsSlider.id = 'chaikin-iterations-slider';
    iterationsSlider.min = '1';
    iterationsSlider.max = '4';
    iterationsSlider.value = '1';
    iterationsSlider.step = '1';
    iterationsSlider.style.cssText = `
      width: 100%;
      cursor: pointer;
    `;

    iterationsSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const iterations = parseInt(target.value);
      const iterationsDisplay = document.getElementById('chaikin-iterations-value');
      if (iterationsDisplay) {
        iterationsDisplay.textContent = iterations.toString();
      }
      if (this.onChaikinIterationsChange) {
        this.onChaikinIterationsChange(iterations);
      }
    });

    const iterationsDesc = document.createElement('div');
    iterationsDesc.style.cssText = `
      color: rgba(76, 175, 80, 0.5);
      font-size: 8px;
      margin-top: 1px;
    `;
    iterationsDesc.textContent = 'Corner-cutting smoothing';

    iterationsRow.appendChild(iterationsLabel);
    iterationsRow.appendChild(iterationsSlider);
    iterationsRow.appendChild(iterationsDesc);
    chaikinSection.appendChild(iterationsRow);

    controlsContainer.appendChild(chaikinSection);

    return controlsContainer;
  }

  private createLogContainer(): HTMLDivElement {
    const logContainer = document.createElement('div');
    logContainer.style.cssText = `
      display: none;
    `;
    return logContainer;
  }

  private interceptConsole(): void {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      this.addLog('LOG', args, '#0f0');
    };

    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      this.addLog('ERROR', args, '#f00');
    };

    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      this.addLog('WARN', args, '#ff0');
    };

    console.info = (...args: any[]) => {
      originalInfo.apply(console, args);
      this.addLog('INFO', args, '#0af');
    };

    // Catch unhandled errors
    window.addEventListener('error', (e) => {
      this.addLog('ERROR', [`Unhandled: ${e.message} at ${e.filename}:${e.lineno}`], '#f00');
    });

    window.addEventListener('unhandledrejection', (e) => {
      this.addLog('ERROR', [`Unhandled Promise: ${e.reason}`], '#f00');
    });
  }

  private addLog(type: string, args: any[], color: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] ${type}: ${message}`;
    this.logs.push(logLine);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const logElement = document.createElement('div');
    logElement.style.color = color;
    logElement.style.marginBottom = '4px';
    logElement.textContent = logLine;
    this.logContainer.appendChild(logElement);

    // Auto-scroll to bottom
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // Auto-show on error
    if (type === 'ERROR') {
      this.show();
    }
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  clear(): void {
    this.logs = [];
    this.logContainer.innerHTML = '';
  }

  private async copyLogs(): Promise<void> {
    const text = this.logs.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      // Show feedback by temporarily changing button text
      const copyBtn = this.container.querySelector('button[title="Copy logs to clipboard"]');
      if (copyBtn) {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to copy logs:', error);
      alert('Failed to copy logs to clipboard');
    }
  }

  updateStats(originalCount: number, finalCount: number, simplificationReduction: number, postSimplificationReduction: number): void {
    // Update vertex counts
    const statsOriginal = document.getElementById('stats-original');
    if (statsOriginal) {
      statsOriginal.textContent = originalCount.toLocaleString();
    }

    const statsFinal = document.getElementById('stats-final');
    if (statsFinal) {
      statsFinal.textContent = finalCount.toLocaleString();
    }

    const statsReduction = document.getElementById('stats-reduction');
    if (statsReduction) {
      const totalReduction = ((originalCount - finalCount) / originalCount * 100);
      statsReduction.textContent = `${totalReduction.toFixed(1)}% (${(originalCount - finalCount).toLocaleString()})`;
    }

    // Update slider reduction percentages
    const epsilonReduction = document.getElementById('epsilon-reduction');
    if (epsilonReduction) {
      epsilonReduction.textContent = simplificationReduction > 0 ? `(-${simplificationReduction.toFixed(1)}%)` : '';
    }

    const epsilonPostReduction = document.getElementById('epsilon-post-reduction');
    if (epsilonPostReduction) {
      epsilonPostReduction.textContent = postSimplificationReduction > 0 ? `(-${postSimplificationReduction.toFixed(1)}%)` : '';
    }
  }
}
