// Simple in-page console for debugging
// Captures console.log, console.info, console.debug, console.warn, console.error

let isOpen = false;
const messages = [];
const MAX_MESSAGES = 100;

// Store original console methods
const originalLog = console.log;
const originalInfo = console.info;
const originalDebug = console.debug;
const originalWarn = console.warn;
const originalError = console.error;

let output; // Reference to output element

function addMessage(type, args) {
  const text = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');

  messages.push({ type, text, time: new Date().toLocaleTimeString() });

  // Limit message history
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  // Update UI if console is open
  if (isOpen && output) {
    renderMessages();
  }
}

function renderMessages() {
  if (!output) return;

  output.innerHTML = messages.map(msg =>
    `<div class="console-message console-${msg.type}">
      <span class="console-time">[${msg.time}]</span>
      <span class="console-text">${escapeHtml(msg.text)}</span>
    </div>`
  ).join('');

  // Auto-scroll to bottom
  output.scrollTop = output.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function init() {
  const toggle = document.getElementById('console-toggle');
  const panel = document.getElementById('console-panel');
  output = document.getElementById('console-output');
  const clear = document.getElementById('console-clear');

  // Toggle console visibility
  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.style.display = isOpen ? 'flex' : 'none';
    toggle.textContent = isOpen ? '✕' : '🐛';

    // Render messages when opening
    if (isOpen) {
      renderMessages();
    }
  });

  // Clear console
  clear.addEventListener('click', () => {
    messages.length = 0;
    output.innerHTML = '';
  });

  // Intercept console methods
  console.log = (...args) => {
    originalLog(...args);
    addMessage('log', args);
  };

  console.info = (...args) => {
    originalInfo(...args);
    addMessage('log', args); // Display as log
  };

  console.debug = (...args) => {
    originalDebug(...args);
    addMessage('log', args); // Display as log
  };

  console.warn = (...args) => {
    originalWarn(...args);
    addMessage('warn', args);
  };

  console.error = (...args) => {
    originalError(...args);
    addMessage('error', args);
  };
}

export { init };
