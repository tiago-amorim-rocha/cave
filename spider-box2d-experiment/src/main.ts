/**
 * Spider Box2D Experiment - Main Entry Point
 *
 * Minimal experiment to test spider controller with Box2D
 * 1-to-1 Unity port using Box2D TypeScript
 */

import { b2World, b2Vec2 } from '@box2d/core';
import { SpiderController } from './SpiderController';
import { SpiderRenderer } from './SpiderRenderer';
import { LogWindow } from './LogWindow';

// === Configuration ===
const PHYSICS_HZ = 60; // Fixed timestep: 60 Hz (matches Unity)
const PHYSICS_DT = 1 / PHYSICS_HZ;
const MAX_FRAME_TIME = 0.25; // Max time per frame (prevent spiral of death)

// === Global State ===
let world: b2World;
let spider: SpiderController;
let renderer: SpiderRenderer;
let canvas: HTMLCanvasElement;

// Input state
let upButtonPressed = false;

// Timing
let lastTime = 0;
let accumulator = 0;
let frameCount = 0;
let fps = 0;
let fpsUpdateTime = 0;
let fpsFrameCount = 0;

/**
 * Initialize Box2D world
 */
function initWorld(): void {
  const gravity = new b2Vec2(0, 0);
  world = b2World.Create(gravity);
}

/**
 * Initialize spider controller
 */
function initSpider(): void {
  spider = new SpiderController(world, 0, 0);
}

/**
 * Initialize renderer
 */
function initRenderer(): void {
  canvas = document.getElementById('canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (renderer) {
      renderer.setOffset(canvas.width / 2, canvas.height / 2);
    }
  };
  resize();
  window.addEventListener('resize', resize);

  renderer = new SpiderRenderer(canvas);
  renderer.setScale(50);
}

/**
 * Initialize UI and input handlers
 */
function initUI(): void {
  const upButton = document.getElementById('up-button');
  if (!upButton) {
    throw new Error('UP button not found');
  }

  upButton.addEventListener('mousedown', () => { upButtonPressed = true; });
  upButton.addEventListener('mouseup', () => { upButtonPressed = false; });
  upButton.addEventListener('mouseleave', () => { upButtonPressed = false; });
  upButton.addEventListener('touchstart', (e) => { e.preventDefault(); upButtonPressed = true; });
  upButton.addEventListener('touchend', (e) => { e.preventDefault(); upButtonPressed = false; });
  upButton.addEventListener('touchcancel', (e) => { e.preventDefault(); upButtonPressed = false; });
}

/**
 * Update stats display
 */
function updateStats(): void {
  // Update FPS every 0.5 seconds
  const now = performance.now() / 1000;
  if (now - fpsUpdateTime >= 0.5) {
    fps = Math.round((fpsFrameCount * 2)); // *2 because we update every 0.5s
    fpsFrameCount = 0;
    fpsUpdateTime = now;
  }

  // Get spider state
  const bodyPos = spider.getBodyPosition();
  const bodyVel = spider.getBodyVelocity();
  const bodyRot = spider.getBodyRotation();
  const input = upButtonPressed ? 1.0 : 0.0;

  // Update HTML elements
  const fpsEl = document.getElementById('fps');
  const inputEl = document.getElementById('input');
  const bodyYEl = document.getElementById('body-y');
  const bodyVelYEl = document.getElementById('body-vel-y');
  const bodyRotEl = document.getElementById('body-rot');

  if (fpsEl) fpsEl.textContent = fps.toString();
  if (inputEl) inputEl.textContent = input.toFixed(2);
  if (bodyYEl) bodyYEl.textContent = bodyPos.y.toFixed(2);
  if (bodyVelYEl) bodyVelYEl.textContent = bodyVel.y.toFixed(2);
  if (bodyRotEl) bodyRotEl.textContent = (bodyRot * 180 / Math.PI).toFixed(1) + '°';
}

/**
 * Fixed timestep physics update
 */
function fixedUpdate(): void {
  // Set spider input based on button state
  const verticalInput = upButtonPressed ? 1.0 : 0.0; // UP = positive
  const horizontalInput = 0.0; // No horizontal input for this experiment
  spider.setInput(verticalInput, horizontalInput);

  // Update spider controller (computes forces, applies torques)
  spider.update(PHYSICS_DT);

  // Step physics world
  world.Step(PHYSICS_DT, {
    velocityIterations: 8,
    positionIterations: 3,
  });
}

/**
 * Render frame
 */
function render(): void {
  renderer.clear();
  renderer.drawGrid(1);
  renderer.drawGround(-2);

  const renderData = spider.getRenderData();
  renderer.drawSpider(renderData);

  fpsFrameCount++;
}

/**
 * Main update loop
 */
function update(time: number): void {
  time = time / 1000;

  // Calculate delta time
  let deltaTime = lastTime === 0 ? 0 : time - lastTime;
  lastTime = time;

  // Clamp delta time to prevent spiral of death
  if (deltaTime > MAX_FRAME_TIME) {
    deltaTime = MAX_FRAME_TIME;
  }

  // Accumulate time for fixed timestep
  accumulator += deltaTime;

  // Run fixed timestep updates
  while (accumulator >= PHYSICS_DT) {
    fixedUpdate();
    accumulator -= PHYSICS_DT;
    frameCount++;
  }

  // Render
  render();

  // Update stats
  updateStats();

  // Request next frame
  requestAnimationFrame(update);
}

/**
 * Main entry point
 */
async function main() {
  const logWindow = new LogWindow();

  initWorld();
  initSpider();
  initRenderer();
  initUI();

  requestAnimationFrame(update);
}

// Start the app
main();
