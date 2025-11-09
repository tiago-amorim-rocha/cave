/**
 * Debug console for displaying logs on-screen
 */
export class DebugConsole {
  private container: HTMLDivElement;
  private logContainer: HTMLDivElement;
  private controlsContainer: HTMLDivElement;
  private isVisible = false;
  private logs: string[] = [];
  private maxLogs = 100;

  // Toggle callbacks
  public onTogglePhysicsMesh?: (enabled: boolean) => void;
  public onToggleOptimizedVertices?: (enabled: boolean) => void;
  public onToggleOriginalVertices?: (enabled: boolean) => void;
  public onToggleGrid?: (enabled: boolean) => void;
  public onSimplificationChange?: (epsilon: number) => void;
  public onAngleThresholdChange?: (angleDegrees: number) => void;

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
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 600px;
      height: 70vh;
      background: rgba(0, 0, 0, 0.95);
      border: 2px solid #4CAF50;
      border-radius: 8px;
      z-index: 10000;
      display: none;
      flex-direction: column;
      font-family: 'Courier New', monospace;
      font-size: 12px;
    `;

    // Add title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      background: #4CAF50;
      color: #000;
      padding: 8px 12px;
      font-weight: bold;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 6px 6px 0 0;
    `;
    titleBar.innerHTML = '<span>Debug Console</span>';

    // Button container for copy and close buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 8px;
      align-items: center;
    `;

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.style.cssText = `
      background: none;
      border: none;
      color: #000;
      font-size: 18px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
    `;
    copyBtn.title = 'Copy logs to clipboard';
    copyBtn.onclick = () => this.copyLogs();
    buttonContainer.appendChild(copyBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #000;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
    `;
    closeBtn.onclick = () => this.hide();
    buttonContainer.appendChild(closeBtn);

    titleBar.appendChild(buttonContainer);
    container.appendChild(titleBar);

    return container;
  }

  private createControlsContainer(): HTMLDivElement {
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
      background: rgba(20, 20, 20, 0.9);
      padding: 12px;
      border-bottom: 1px solid #4CAF50;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = 'Debug Visualization';
    title.style.cssText = `
      color: #4CAF50;
      font-weight: bold;
      margin-bottom: 4px;
    `;
    controlsContainer.appendChild(title);

    // Create toggles
    const toggles = [
      { label: 'Physics Mesh', key: 'physics', callback: 'onTogglePhysicsMesh' },
      { label: 'Optimized Vertices', key: 'optimized', callback: 'onToggleOptimizedVertices' },
      { label: 'Original Vertices', key: 'original', callback: 'onToggleOriginalVertices' },
      { label: 'Grid', key: 'grid', callback: 'onToggleGrid' }
    ];

    toggles.forEach(({ label, key, callback }) => {
      const toggleRow = document.createElement('div');
      toggleRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `debug-${key}`;
      checkbox.style.cssText = `
        cursor: pointer;
        width: 16px;
        height: 16px;
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
        color: #0f0;
        cursor: pointer;
        user-select: none;
      `;

      toggleRow.appendChild(checkbox);
      toggleRow.appendChild(labelEl);
      controlsContainer.appendChild(toggleRow);
    });

    // Add angle threshold slider
    const angleSliderRow = document.createElement('div');
    angleSliderRow.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
    `;

    const angleSliderLabel = document.createElement('div');
    angleSliderLabel.style.cssText = `
      color: #4CAF50;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
    `;
    angleSliderLabel.innerHTML = '<span>Angle Threshold</span><span id="angle-value">3.0°</span>';

    const angleSlider = document.createElement('input');
    angleSlider.type = 'range';
    angleSlider.id = 'angle-slider';
    angleSlider.min = '0';
    angleSlider.max = '45';
    angleSlider.value = '3';
    angleSlider.step = '1';
    angleSlider.style.cssText = `
      width: 100%;
      cursor: pointer;
    `;

    angleSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const angleDegrees = parseInt(target.value);
      const angleDisplay = document.getElementById('angle-value');
      if (angleDisplay) {
        angleDisplay.textContent = `${angleDegrees.toFixed(1)}°`;
      }
      if (this.onAngleThresholdChange) {
        this.onAngleThresholdChange(angleDegrees);
      }
    });

    const angleSliderDesc = document.createElement('div');
    angleSliderDesc.style.cssText = `
      color: #888;
      font-size: 10px;
      margin-top: 2px;
    `;
    angleSliderDesc.textContent = 'collapseCollinear angle (runs 1st)';

    angleSliderRow.appendChild(angleSliderLabel);
    angleSliderRow.appendChild(angleSlider);
    angleSliderRow.appendChild(angleSliderDesc);
    controlsContainer.appendChild(angleSliderRow);

    // Add distance simplification slider
    const distSliderRow = document.createElement('div');
    distSliderRow.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    `;

    const distSliderLabel = document.createElement('div');
    distSliderLabel.style.cssText = `
      color: #4CAF50;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
    `;
    distSliderLabel.innerHTML = '<span>Distance Threshold (ε)</span><span id="epsilon-value">0.000m</span>';

    const distSlider = document.createElement('input');
    distSlider.type = 'range';
    distSlider.id = 'simplification-slider';
    distSlider.min = '0';
    distSlider.max = '50';
    distSlider.value = '0';
    distSlider.step = '1';
    distSlider.style.cssText = `
      width: 100%;
      cursor: pointer;
    `;

    distSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const value = parseInt(target.value);
      // Map 0-50 to 0-0.5m exponentially for finer control at low values
      const epsilon = value === 0 ? 0 : Math.pow(value / 100, 1.5);
      const epsilonDisplay = document.getElementById('epsilon-value');
      if (epsilonDisplay) {
        epsilonDisplay.textContent = `${epsilon.toFixed(3)}m`;
      }
      if (this.onSimplificationChange) {
        this.onSimplificationChange(epsilon);
      }
    });

    const distSliderDesc = document.createElement('div');
    distSliderDesc.style.cssText = `
      color: #888;
      font-size: 10px;
      margin-top: 2px;
    `;
    distSliderDesc.textContent = 'Douglas-Peucker distance (runs 2nd)';

    distSliderRow.appendChild(distSliderLabel);
    distSliderRow.appendChild(distSlider);
    distSliderRow.appendChild(distSliderDesc);
    controlsContainer.appendChild(distSliderRow);

    return controlsContainer;
  }

  private createLogContainer(): HTMLDivElement {
    const logContainer = document.createElement('div');
    logContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      color: #0f0;
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
}
