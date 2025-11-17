/**
 * Spider Debug UI
 *
 * Provides real-time parameter tweaking for spider controller
 */

import type { SpiderController } from './controllers/spider/SpiderController';
import type { SpiderConfig } from './controllers/spider/SpiderTypes';

export class SpiderDebugUI {
  private panel: HTMLDivElement;
  private visible = false;
  private controller: SpiderController | null = null;
  private config: SpiderConfig;

  constructor() {
    this.panel = this.createPanel();
    this.config = {} as SpiderConfig; // Will be set when controller is attached
    document.body.appendChild(this.panel);
  }

  private createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'spider-debug-ui';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 10px;
      background: rgba(0, 0, 0, 0.85);
      border: 2px solid #00ff00;
      border-radius: 8px;
      padding: 15px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #00ff00;
      max-height: 80vh;
      overflow-y: auto;
      display: none;
      z-index: 10000;
      min-width: 300px;
    `;

    panel.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #00ff00; font-size: 14px;">🕷️ Spider Debug</h3>
      <div id="spider-debug-content">
        <p style="color: #888;">Attach a spider controller to enable</p>
      </div>
    `;

    return panel;
  }

  attachController(controller: SpiderController, config: SpiderConfig): void {
    this.controller = controller;
    this.config = config;
    this.rebuildUI();
  }

  private rebuildUI(): void {
    const content = this.panel.querySelector('#spider-debug-content');
    if (!content) return;

    content.innerHTML = `
      ${this.createSlider('Vertical Gain', 'verticalAccelGain', 0.1, 10, 0.1)}
      ${this.createSlider('Horizontal Gain', 'horizontalAccelGain', 0.1, 10, 0.1)}
      ${this.createSlider('Torque Gain', 'torqueGain', 0.1, 10, 0.1)}
      ${this.createSlider('Max Joint Torque', 'maxJointTorque', 10, 500, 10)}
      <hr style="border-color: #00ff00; margin: 10px 0;">
      ${this.createSlider('Joint Limit Kp', 'jointLimitKp', 0.01, 1, 0.01)}
      ${this.createSlider('Joint Limit Kd', 'jointLimitKd', 0.01, 0.5, 0.01)}
      <hr style="border-color: #00ff00; margin: 10px 0;">
      ${this.createSlider('Rotation Stiffness', 'rotationStiffness', 0.01, 1, 0.01)}
      ${this.createSlider('Rotation Damping', 'rotationDamping', 0.01, 0.5, 0.01)}
      <hr style="border-color: #00ff00; margin: 10px 0;">
      <div style="display: flex; gap: 5px; margin-top: 10px;">
        <button id="spider-reset-btn" style="flex: 1; padding: 5px; background: #ff0000; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Reset Defaults
        </button>
        <button id="spider-respawn-btn" style="flex: 1; padding: 5px; background: #0088ff; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Respawn
        </button>
      </div>
      <div style="margin-top: 10px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; font-size: 10px;">
        <div id="spider-debug-info"></div>
      </div>
    `;

    // Attach event listeners
    this.attachSliderListeners();
    this.attachButtonListeners();
  }

  private createSlider(label: string, key: keyof SpiderConfig, min: number, max: number, step: number): string {
    const value = this.config[key] as number;
    return `
      <div style="margin-bottom: 8px;">
        <label style="display: block; margin-bottom: 3px; font-size: 10px;">
          ${label}: <span id="${key}-value" style="color: #ffff00;">${value.toFixed(3)}</span>
        </label>
        <input
          type="range"
          id="${key}"
          min="${min}"
          max="${max}"
          step="${step}"
          value="${value}"
          style="width: 100%; cursor: pointer;"
        />
      </div>
    `;
  }

  private attachSliderListeners(): void {
    const sliders = this.panel.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
      const input = slider as HTMLInputElement;
      const key = input.id as keyof SpiderConfig;

      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        (this.config as any)[key] = value;

        const valueSpan = this.panel.querySelector(`#${key}-value`);
        if (valueSpan) {
          valueSpan.textContent = value.toFixed(3);
        }
      });
    });
  }

  private attachButtonListeners(): void {
    const resetBtn = this.panel.querySelector('#spider-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (this.controller) {
          // Reset to defaults - would need to re-import DEFAULT_SPIDER_CONFIG
          // console.log('[SpiderDebugUI] Reset to defaults');
          // For now, just respawn
          const pos = this.controller.getPosition();
          this.controller.respawn(pos.x, pos.y);
        }
      });
    }

    const respawnBtn = this.panel.querySelector('#spider-respawn-btn');
    if (respawnBtn) {
      respawnBtn.addEventListener('click', () => {
        if (this.controller) {
          const pos = this.controller.getPosition();
          this.controller.respawn(pos.x, pos.y);
        }
      });
    }
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
  }

  show(): void {
    this.visible = true;
    this.panel.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.panel.style.display = 'none';
  }

  updateInfo(info: string): void {
    const infoDiv = this.panel.querySelector('#spider-debug-info');
    if (infoDiv) {
      infoDiv.innerHTML = info;
    }
  }
}
