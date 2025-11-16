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
  console.log('[Main] Initializing Box2D world');

  try {
    // Check if Box2D classes are available
    console.log('[Main] Checking Box2D availability...');
    console.log('[Main] b2World:', typeof b2World);
    console.log('[Main] b2Vec2:', typeof b2Vec2);
    console.log('[Main] b2World.Create:', typeof b2World.Create);

    // Create world with zero gravity (spider has gravity scale = 0 anyway)
    console.log('[Main] Creating gravity vector (0, 0)');
    const gravity = new b2Vec2(0, 0);
    console.log('[Main] Gravity created:', gravity);

    console.log('[Main] Calling b2World.Create()');
    world = b2World.Create(gravity);

    console.log('[Main] World created:', world);
    console.log('[Main] World type:', typeof world);
  } catch (error) {
    console.error('[Main] Error creating Box2D world:', error);
    console.error('[Main] Error type:', typeof error);
    console.error('[Main] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[Main] Error stack:', error instanceof Error ? error.stack : 'N/A');
    throw error;
  }
}

/**
 * Initialize spider controller
 */
function initSpider(): void {
  console.log('[Main] Initializing spider controller');

  // Create spider at origin, feet at y = -2
  spider = new SpiderController(world, 0, 0);

  console.log('[Main] Spider controller created');
}

/**
 * Initialize renderer
 */
function initRenderer(): void {
  console.log('[Main] Initializing renderer');

  canvas = document.getElementById('canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }

  // Set canvas size to fill window
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
  renderer.setScale(50); // 50 pixels per metre

  console.log('[Main] Renderer created');
}

/**
 * Initialize UI and input handlers
 */
function initUI(): void {
  console.log('[Main] Initializing UI');

  // UP button
  const upButton = document.getElementById('up-button');
  if (!upButton) {
    throw new Error('UP button not found');
  }

  // Mouse/touch events
  upButton.addEventListener('mousedown', () => {
    upButtonPressed = true;
    console.log('[Input] UP button pressed');
  });

  upButton.addEventListener('mouseup', () => {
    upButtonPressed = false;
    console.log('[Input] UP button released');
  });

  upButton.addEventListener('mouseleave', () => {
    upButtonPressed = false;
  });

  upButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    upButtonPressed = true;
    console.log('[Input] UP button pressed (touch)');
  });

  upButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    upButtonPressed = false;
    console.log('[Input] UP button released (touch)');
  });

  upButton.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    upButtonPressed = false;
  });

  console.log('[Main] UI initialized');
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
  // Clear canvas
  renderer.clear();

  // Draw grid
  renderer.drawGrid(1);

  // Draw ground reference line (y = -2)
  renderer.drawGround(-2);

  // Draw spider
  const renderData = spider.getRenderData();

  // Log render data periodically
  if (frameCount % 120 === 0 || frameCount <= 3) {
    console.log(`[Render] Frame ${frameCount}:`, {
      body: {
        x: renderData.body.x.toFixed(3),
        y: renderData.body.y.toFixed(3),
        angle: (renderData.body.angle * 180 / Math.PI).toFixed(1) + '°',
      },
      leftLeg: {
        hip: { x: renderData.leftLeg.hip.x.toFixed(3), y: renderData.leftLeg.hip.y.toFixed(3) },
        foot: { x: renderData.leftLeg.foot.x.toFixed(3), y: renderData.leftLeg.foot.y.toFixed(3) },
      },
      rightLeg: {
        hip: { x: renderData.rightLeg.hip.x.toFixed(3), y: renderData.rightLeg.hip.y.toFixed(3) },
        foot: { x: renderData.rightLeg.foot.x.toFixed(3), y: renderData.rightLeg.foot.y.toFixed(3) },
      },
    });
  }

  renderer.drawSpider(renderData);

  fpsFrameCount++;
}

/**
 * Main update loop
 */
function update(time: number): void {
  // Log first update call
  if (frameCount === 0) {
    console.log('[Main] Update loop started at time:', time);
  }

  // Convert time to seconds
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
  // Initialize log window FIRST to capture all logs
  const logWindow = new LogWindow();

  console.log('[Main] ========================================');
  console.log('[Main] Spider Box2D Experiment');
  console.log('[Main] 1-to-1 Unity port using Box2D TypeScript');
  console.log('[Main] ========================================');

  try {
    // Initialize systems
    console.log('[Main] Initializing world...');
    initWorld();
    console.log('[Main] World initialized successfully');

    console.log('[Main] Initializing spider...');
    initSpider();
    console.log('[Main] Spider initialized successfully');

    console.log('[Main] Initializing renderer...');
    initRenderer();
    console.log('[Main] Renderer initialized successfully');

    console.log('[Main] Initializing UI...');
    initUI();
    console.log('[Main] UI initialized successfully');

    console.log('[Main] All systems initialized');
    console.log('[Main] Starting update loop');
    console.log('[Main] Press UP button to move spider upward');
    console.log('[Main] ========================================');

    // Start update loop
    requestAnimationFrame(update);
  } catch (error) {
    console.error('[Main] ==================== INITIALIZATION ERROR ====================');
    console.error('[Main] Error object:', error);
    console.error('[Main] Error type:', typeof error);
    console.error('[Main] Error constructor:', error?.constructor?.name);

    if (error instanceof Error) {
      console.error('[Main] Error message:', error.message);
      console.error('[Main] Error stack:', error.stack);
    } else {
      console.error('[Main] Error string:', String(error));
      console.error('[Main] Error JSON:', JSON.stringify(error, null, 2));
    }
    console.error('[Main] ================================================================');

    // Don't re-throw, let the app show the error in the log window
  }
}

// Start the app
main();
