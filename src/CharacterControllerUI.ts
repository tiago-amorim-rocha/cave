/**
 * Simple debug UI for character controller tuning
 * Shows just the essential parameters: Force and Drag
 */

export class CharacterControllerUI {
  private container: HTMLDivElement;
  private isVisible = false;

  // Callbacks
  public onForceChange?: (force: number) => void;
  public onDragChange?: (drag: number) => void;

  constructor() {
    this.container = this.createContainer();
    document.body.appendChild(this.container);
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'character-controller-ui';
    container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 10px;
      padding: 20px;
      z-index: 10000;
      display: none;
      min-width: 350px;
      color: white;
      font-family: monospace;
    `;

    // Title
    const title = document.createElement('h2');
    title.textContent = 'Character Controller';
    title.style.cssText = `
      margin: 0 0 20px 0;
      font-size: 18px;
      color: #00ffff;
      text-align: center;
    `;
    container.appendChild(title);

    // Explanation
    const explanation = document.createElement('div');
    explanation.innerHTML = `
      <p style="margin: 0 0 15px 0; font-size: 12px; color: #aaa;">
        <strong>Physics Model:</strong><br>
        • Force: Applied via engine when moving<br>
        • Drag: Rapier's linearDamping (automatic)<br>
        • Max Speed = Force / (Mass × Drag)
      </p>
    `;
    container.appendChild(explanation);

    // Movement Force slider
    const forceGroup = this.createSliderGroup(
      'Movement Force',
      'movement-force',
      5,    // min
      50,   // max
      20,   // default
      0.5,  // step
      ' N',
      (value) => this.onForceChange?.(value)
    );
    container.appendChild(forceGroup);

    // Drag slider
    const dragGroup = this.createSliderGroup(
      'Drag Coefficient',
      'drag',
      0.1,  // min
      20,   // max
      5,    // default
      0.1,  // step
      '',
      (value) => this.onDragChange?.(value)
    );
    container.appendChild(dragGroup);

    // Calculated max speed display
    const maxSpeedDisplay = document.createElement('div');
    maxSpeedDisplay.id = 'max-speed-display';
    maxSpeedDisplay.style.cssText = `
      margin-top: 20px;
      padding: 10px;
      background: rgba(0, 255, 255, 0.1);
      border-radius: 5px;
      text-align: center;
      font-size: 14px;
      color: #00ffff;
    `;
    maxSpeedDisplay.innerHTML = '<strong>v_max = 4.00 m/s</strong>';
    container.appendChild(maxSpeedDisplay);

    // Close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = `
      margin-top: 20px;
      width: 100%;
      padding: 10px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-family: monospace;
    `;
    closeButton.addEventListener('click', () => this.hide());
    container.appendChild(closeButton);

    return container;
  }

  private createSliderGroup(
    label: string,
    id: string,
    min: number,
    max: number,
    defaultValue: number,
    step: number,
    unit: string,
    onChange: (value: number) => void
  ): HTMLDivElement {
    const group = document.createElement('div');
    group.style.cssText = `
      margin-bottom: 15px;
    `;

    // Label
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `
      display: block;
      margin-bottom: 5px;
      font-size: 12px;
      color: #ccc;
    `;
    group.appendChild(labelEl);

    // Slider + value display container
    const sliderContainer = document.createElement('div');
    sliderContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    // Slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.min = min.toString();
    slider.max = max.toString();
    slider.value = defaultValue.toString();
    slider.step = step.toString();
    slider.style.cssText = `
      flex: 1;
      height: 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
      cursor: pointer;
    `;

    // Value display
    const valueDisplay = document.createElement('span');
    valueDisplay.id = `${id}-value`;
    valueDisplay.textContent = `${defaultValue.toFixed(1)}${unit}`;
    valueDisplay.style.cssText = `
      min-width: 60px;
      text-align: right;
      font-size: 12px;
      color: #00ffff;
    `;

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      valueDisplay.textContent = `${value.toFixed(1)}${unit}`;
      onChange(value);
      this.updateMaxSpeedDisplay();
    });

    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);
    group.appendChild(sliderContainer);

    return group;
  }

  /**
   * Update the max speed display based on current force and drag
   */
  private updateMaxSpeedDisplay(): void {
    const forceSlider = document.getElementById('movement-force') as HTMLInputElement;
    const dragSlider = document.getElementById('drag') as HTMLInputElement;
    const maxSpeedDisplay = document.getElementById('max-speed-display');

    if (forceSlider && dragSlider && maxSpeedDisplay) {
      const force = parseFloat(forceSlider.value);
      const drag = parseFloat(dragSlider.value);
      const maxSpeed = drag > 0 ? force / drag : Infinity;

      maxSpeedDisplay.innerHTML = `<strong>v_max = ${maxSpeed.toFixed(2)} m/s</strong>`;
    }
  }

  /**
   * Show the UI
   */
  show(): void {
    this.isVisible = true;
    this.container.style.display = 'block';
  }

  /**
   * Hide the UI
   */
  hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Update slider values (when loading from player)
   */
  updateValues(force: number, drag: number): void {
    const forceSlider = document.getElementById('movement-force') as HTMLInputElement;
    const dragSlider = document.getElementById('drag') as HTMLInputElement;
    const forceValue = document.getElementById('movement-force-value');
    const dragValue = document.getElementById('drag-value');

    if (forceSlider && forceValue) {
      forceSlider.value = force.toString();
      forceValue.textContent = `${force.toFixed(1)} N`;
    }

    if (dragSlider && dragValue) {
      dragSlider.value = drag.toString();
      dragValue.textContent = `${drag.toFixed(1)}`;
    }

    this.updateMaxSpeedDisplay();
  }
}
