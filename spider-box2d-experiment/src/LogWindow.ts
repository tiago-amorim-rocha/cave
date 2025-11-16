/**
 * Log Window - On-screen debug console
 * Captures console.log/warn/error and displays them on screen
 */

export class LogWindow {
  private container: HTMLDivElement;
  private logList: HTMLDivElement;
  private toggleButton: HTMLButtonElement;
  private isVisible: boolean = true;
  private maxLogs: number = 100;

  // Store original console methods
  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;
  private originalError: typeof console.error;

  constructor() {
    // Create UI elements
    this.container = this.createContainer();
    this.logList = this.createLogList();
    this.toggleButton = this.createToggleButton();

    // Add to DOM
    this.container.appendChild(this.createHeader());
    this.container.appendChild(this.logList);
    document.body.appendChild(this.container);
    document.body.appendChild(this.toggleButton);

    // Store original console methods
    this.originalLog = console.log.bind(console);
    this.originalWarn = console.warn.bind(console);
    this.originalError = console.error.bind(console);

    // Intercept console methods
    this.interceptConsole();

    console.log('[LogWindow] Debug log window initialized');
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'log-window';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 500px;
      max-height: 400px;
      background: rgba(0, 0, 0, 0.95);
      border: 2px solid #00ff00;
      border-radius: 8px;
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 11px;
      color: #00ff00;
      display: flex;
      flex-direction: column;
      z-index: 10000;
      box-shadow: 0 4px 20px rgba(0, 255, 0, 0.3);
    `;
    return container;
  }

  private createHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 10px 15px;
      background: rgba(0, 255, 0, 0.1);
      border-bottom: 1px solid #00ff00;
      font-weight: bold;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

    const title = document.createElement('span');
    title.textContent = '📝 Debug Console';

    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear';
    clearButton.style.cssText = `
      background: transparent;
      border: 1px solid #00ff00;
      color: #00ff00;
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 10px;
      transition: all 0.2s;
    `;
    clearButton.onmouseover = () => {
      clearButton.style.background = '#00ff00';
      clearButton.style.color = '#000';
    };
    clearButton.onmouseout = () => {
      clearButton.style.background = 'transparent';
      clearButton.style.color = '#00ff00';
    };
    clearButton.onclick = () => this.clear();

    header.appendChild(title);
    header.appendChild(clearButton);
    return header;
  }

  private createLogList(): HTMLDivElement {
    const list = document.createElement('div');
    list.style.cssText = `
      overflow-y: auto;
      padding: 10px;
      flex: 1;
      line-height: 1.5;
    `;
    return list;
  }

  private createToggleButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = 'log-toggle';
    button.textContent = '📝';
    button.title = 'Toggle Debug Console';
    button.style.cssText = `
      position: fixed;
      bottom: 440px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: #00ff00;
      color: #000;
      border: none;
      font-size: 24px;
      cursor: pointer;
      z-index: 10001;
      box-shadow: 0 2px 10px rgba(0, 255, 0, 0.5);
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    button.onmouseover = () => {
      button.style.transform = 'scale(1.1)';
      button.style.boxShadow = '0 4px 20px rgba(0, 255, 0, 0.8)';
    };
    button.onmouseout = () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 2px 10px rgba(0, 255, 0, 0.5)';
    };
    button.onclick = () => this.toggle();

    return button;
  }

  private interceptConsole(): void {
    // Intercept console.log
    console.log = (...args: any[]) => {
      this.originalLog(...args);
      this.addLog('log', args);
    };

    // Intercept console.warn
    console.warn = (...args: any[]) => {
      this.originalWarn(...args);
      this.addLog('warn', args);
    };

    // Intercept console.error
    console.error = (...args: any[]) => {
      this.originalError(...args);
      this.addLog('error', args);
    };
  }

  private addLog(type: 'log' | 'warn' | 'error', args: any[]): void {
    const logEntry = document.createElement('div');
    logEntry.style.cssText = `
      padding: 4px 0;
      border-bottom: 1px solid rgba(0, 255, 0, 0.1);
      word-wrap: break-word;
    `;

    // Format timestamp
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Format message
    const message = args
      .map((arg) => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');

    // Color based on type
    let color = '#00ff00';
    let prefix = '→';
    if (type === 'warn') {
      color = '#ffaa00';
      prefix = '⚠';
    } else if (type === 'error') {
      color = '#ff0000';
      prefix = '✖';
    }

    logEntry.style.color = color;
    logEntry.innerHTML = `
      <span style="color: #666; font-size: 10px;">[${timestamp}]</span>
      <span style="color: ${color}; margin: 0 5px;">${prefix}</span>
      <span style="color: ${color};">${this.escapeHtml(message)}</span>
    `;

    this.logList.appendChild(logEntry);

    // Limit log entries
    while (this.logList.children.length > this.maxLogs) {
      this.logList.removeChild(this.logList.firstChild!);
    }

    // Auto-scroll to bottom
    this.logList.scrollTop = this.logList.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  public clear(): void {
    this.logList.innerHTML = '';
    this.originalLog('[LogWindow] Console cleared');
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'flex' : 'none';
    this.toggleButton.style.opacity = this.isVisible ? '1' : '0.5';
  }

  public show(): void {
    this.isVisible = true;
    this.container.style.display = 'flex';
    this.toggleButton.style.opacity = '1';
  }

  public hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
    this.toggleButton.style.opacity = '0.5';
  }
}
