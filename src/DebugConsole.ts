/**
 * Debug console for displaying logs on-screen
 */
export class DebugConsole {
  private container: HTMLDivElement;
  private logContainer: HTMLDivElement;
  private isVisible = false;
  private logs: string[] = [];
  private maxLogs = 100;

  constructor() {
    this.container = this.createContainer();
    this.logContainer = this.createLogContainer();
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
    titleBar.appendChild(closeBtn);

    container.appendChild(titleBar);

    return container;
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
}
