/**
 * Spider Debug UI
 *
 * Provides real-time parameter tweaking for spider controller
 * Organized into categories with collapsible sections
 */

import type { SpiderController } from './controllers/spider/SpiderController';
import type { SpiderConfig } from './controllers/spider/SpiderTypes';
import { DEFAULT_SPIDER_CONFIG } from './controllers/spider/SpiderTypes';

interface SliderDef {
  key: keyof SpiderConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  tooltip?: string;
}

export class SpiderDebugUI {
  private panel: HTMLDivElement;
  private visible = false;
  private controller: SpiderController | null = null;
  private config: SpiderConfig;
  private collapsedSections: Set<string> = new Set();

  constructor() {
    this.panel = this.createPanel();
    this.config = {} as SpiderConfig;
    document.body.appendChild(this.panel);
  }

  private createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'spider-debug-ui';
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
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
      min-width: 340px;
      max-width: 400px;
    `;

    panel.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #00ff00; font-size: 14px; text-align: center;">🕷️ Spider Physics Debug</h3>
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
      ${this.createSection('Leg Geometry', [
        { key: 'legSegmentWidth', label: 'Leg Width (m)', min: 0.05, max: 0.5, step: 0.01, tooltip: 'Width of leg colliders - thicker = more inertia (RESPAWN to apply)' },
      ])}

      ${this.createSection('Mass & Inertia', [
        { key: 'bodyMassScale', label: 'Body Mass Scale', min: 0.1, max: 5.0, step: 0.1, tooltip: 'Higher = heavier body = more stable' },
        { key: 'legMassScale', label: 'Leg Mass Scale', min: 0.1, max: 5.0, step: 0.1, tooltip: 'Higher = less noodly legs' },
        { key: 'bodyInertiaScale', label: 'Body Inertia Scale', min: 0.1, max: 5.0, step: 0.1, tooltip: 'Higher = resists rotation' },
        { key: 'legInertiaScale', label: 'Leg Inertia Scale', min: 0.1, max: 5.0, step: 0.1, tooltip: 'Higher = smoother leg motion' },
      ])}

      ${this.createSection('Damping', [
        { key: 'bodyLinearDamping', label: 'Body Linear Damping', min: 0.0, max: 2.0, step: 0.05, tooltip: 'Resistance to linear motion' },
        { key: 'bodyAngularDamping', label: 'Body Angular Damping', min: 0.0, max: 2.0, step: 0.05, tooltip: 'Resistance to rotation - prevents oscillation' },
        { key: 'legLinearDamping', label: 'Leg Linear Damping', min: 0.0, max: 2.0, step: 0.05, tooltip: 'Resistance to leg movement' },
        { key: 'legAngularDamping', label: 'Leg Angular Damping', min: 0.0, max: 2.0, step: 0.05, tooltip: 'BIG for spaghetti control - higher = waves die fast' },
      ])}

      ${this.createSection('Controller Gains', [
        { key: 'verticalAccelGain', label: 'Vertical Accel Gain', min: 0.1, max: 10, step: 0.1, tooltip: 'Vertical force per unit input' },
        { key: 'horizontalAccelGain', label: 'Horizontal Accel Gain', min: 0.1, max: 10, step: 0.1, tooltip: 'Horizontal force per unit input' },
        { key: 'torqueGain', label: 'Jacobian Torque Gain', min: 0.1, max: 10, step: 0.1, tooltip: 'Higher = stronger pushes, more energy' },
        { key: 'maxJointTorque', label: 'Max Joint Torque', min: 10, max: 500, step: 10, tooltip: 'Upper bound - prevents explosive wobble' },
      ])}

      ${this.createSection('Joint Limit Springs', [
        { key: 'jointLimitKp', label: 'Limit Stiffness (Kp)', min: 0.0, max: 1.0, step: 0.01, tooltip: 'Higher = joint hits wall harder' },
        { key: 'jointLimitKd', label: 'Limit Damping (Kd)', min: 0.0, max: 0.5, step: 0.01, tooltip: 'Higher = smoother limit collision' },
      ])}

      ${this.createSection('Joint Posture Control', [
        { key: 'jointRotationKp', label: 'Posture Stiffness (Kp)', min: 0.0, max: 1.0, step: 0.01, tooltip: 'Tries to pull joints to desired angle - higher = snappier' },
        { key: 'jointRotationKd', label: 'Posture Damping (Kd)', min: 0.0, max: 0.5, step: 0.01, tooltip: 'Higher = less oscillation, more robotic' },
      ])}

      ${this.createSection('Rotation Stabilization', [
        { key: 'rotationStiffness', label: 'Rotation Stiffness', min: 0.0, max: 1.0, step: 0.01, tooltip: 'Keeps spider level' },
        { key: 'rotationDamping', label: 'Rotation Damping', min: 0.0, max: 0.5, step: 0.01, tooltip: 'Smooth rotation control' },
      ])}

      ${this.createSection('Global Physics', [
        { key: 'gravityScale', label: 'Gravity Scale', min: 0.0, max: 2.0, step: 0.1, tooltip: '0 = no gravity, 1 = normal gravity' },
        { key: 'contactFrictionScale', label: 'Friction Scale', min: 0.1, max: 5.0, step: 0.1, tooltip: 'Higher = sticky feet, better stability' },
      ])}

      <div style="display: flex; gap: 5px; margin-top: 10px;">
        <button id="spider-reset-btn" style="flex: 1; padding: 8px; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
          Reset Defaults
        </button>
        <button id="spider-respawn-btn" style="flex: 1; padding: 8px; background: #4488ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
          Respawn
        </button>
      </div>

      <div style="margin-top: 10px; padding: 8px; background: rgba(0,255,0,0.05); border: 1px solid rgba(0,255,0,0.3); border-radius: 4px; font-size: 10px;">
        <div id="spider-debug-info" style="color: #88ff88;"></div>
      </div>
    `;

    // Attach event listeners
    this.attachSectionListeners();
    this.attachSliderListeners();
    this.attachButtonListeners();
  }

  private createSection(title: string, sliders: SliderDef[]): string {
    const sectionId = title.replace(/\s+/g, '-').toLowerCase();
    const isCollapsed = this.collapsedSections.has(sectionId);
    const arrow = isCollapsed ? '▶' : '▼';

    return `
      <div style="margin-bottom: 8px; border: 1px solid rgba(0,255,0,0.3); border-radius: 4px; background: rgba(0,255,0,0.05);">
        <div
          class="section-header"
          data-section="${sectionId}"
          style="padding: 6px 10px; cursor: pointer; font-weight: bold; font-size: 11px; user-select: none; display: flex; justify-content: space-between; align-items: center;"
        >
          <span>${title}</span>
          <span class="section-arrow" style="font-size: 10px;">${arrow}</span>
        </div>
        <div
          class="section-content"
          data-section="${sectionId}"
          style="padding: 8px 10px; display: ${isCollapsed ? 'none' : 'block'};"
        >
          ${sliders.map(s => this.createSlider(s)).join('')}
        </div>
      </div>
    `;
  }

  private createSlider(def: SliderDef): string {
    const value = this.config[def.key] as number;
    const displayValue = typeof value === 'number' ? value.toFixed(3) : '0.000';

    return `
      <div style="margin-bottom: 6px;">
        <label style="display: block; margin-bottom: 2px; font-size: 10px;" title="${def.tooltip || ''}">
          <span style="color: #00ff00;">${def.label}:</span>
          <span id="${def.key}-value" style="color: #ffff00; font-weight: bold;">${displayValue}</span>
        </label>
        <input
          type="range"
          id="${def.key}"
          min="${def.min}"
          max="${def.max}"
          step="${def.step}"
          value="${value}"
          style="width: 100%; cursor: pointer;"
          title="${def.tooltip || ''}"
        />
      </div>
    `;
  }

  private attachSectionListeners(): void {
    const headers = this.panel.querySelectorAll('.section-header');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const sectionId = (header as HTMLElement).dataset.section;
        if (!sectionId) return;

        const content = this.panel.querySelector(`.section-content[data-section="${sectionId}"]`) as HTMLElement;
        const arrow = header.querySelector('.section-arrow') as HTMLElement;

        if (!content || !arrow) return;

        const isCollapsed = content.style.display === 'none';

        if (isCollapsed) {
          content.style.display = 'block';
          arrow.textContent = '▼';
          this.collapsedSections.delete(sectionId);
        } else {
          content.style.display = 'none';
          arrow.textContent = '▶';
          this.collapsedSections.add(sectionId);
        }
      });
    });
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

        // Apply changes in real-time
        if (this.controller) {
          this.controller.applyConfigChanges();
        }
      });
    });
  }

  private attachButtonListeners(): void {
    const resetBtn = this.panel.querySelector('#spider-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        // Reset config to defaults
        Object.assign(this.config, DEFAULT_SPIDER_CONFIG);

        // Rebuild UI to reflect new values
        this.rebuildUI();

        // Apply changes
        if (this.controller) {
          this.controller.applyConfigChanges();
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
