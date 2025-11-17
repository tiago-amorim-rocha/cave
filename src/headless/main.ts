/**
 * Headless Spider Test - Main Entry Point
 *
 * Runs spider controller in headless mode with scripted input.
 * No rendering, no UI - just physics simulation and JSONL logging.
 *
 * Usage:
 *   npm run headless
 *
 * Output:
 *   logs/last-run.jsonl - Structured log file for analysis
 */

import { CoreGame } from './CoreGame';
import { JSONLLogger } from './logger';
import { createSimpleArena } from './terrain';
import { HoldRightScenario } from './scenarios/HoldRightScenario';
import { TinyForceScenario } from './scenarios/TinyForceScenario';
import { VerticalPulseScenario } from './scenarios/VerticalPulseScenario';

/**
 * Main headless simulation loop
 */
async function main() {
  // Create logger
  const logger = new JSONLLogger('logs', 'last-run.jsonl');

  logger.info('========================================');
  logger.info('Headless Spider Test Starting');
  logger.info('========================================');

  try {
    // Create core game
    const game = new CoreGame(logger, {
      fixedDt: 1 / 60 // 60 Hz physics
    });

    // Initialize physics (async - loads Rapier WASM)
    logger.info('Initializing physics...');
    await game.init();

    // Create simple flat terrain
    logger.info('Creating terrain...');
    const terrain = createSimpleArena();
    game.setTerrain(terrain);

    // Create spider with UNITY DEFAULT CONFIG
    // Now that we've fixed angular damping (0.05 instead of 1.0), test with Unity values
    logger.info('Creating spider...');
    logger.info('Using Unity default config (angular damping fixed to 0.05)');
    const testConfig = {
      // Leg geometry - Unity values
      segmentLength1: 1.3,
      segmentLength2: 1.0,
      segmentLength3: 0.7,

      // Mass & Inertia
      bodyMassScale: 1.0,
      legMassScale: 1.0,
      bodyInertiaScale: 1.0,
      legInertiaScale: 1.0,

      // Damping
      bodyLinearDamping: 0.0,
      bodyAngularDamping: 0.05,
      legLinearDamping: 0.0,
      legAngularDamping: 0.05,

      // Vertical control - UNITY VALUES (not reduced!)
      verticalAccelGain: 2.0,  // Unity default
      maxTotalFootForceY: 20.0,

      // Horizontal control - UNITY VALUES (not reduced!)
      horizontalAccelGain: 2.0,  // Unity default
      maxTotalFootForceX: 20.0,

      // Torque scaling - UNITY VALUES (not reduced!)
      torqueGain: 2.0,  // Unity default
      maxJointTorque: 100.0,

      // Joint limit springs - Unity values
      enableHipJointLimits: true,
      enableKneeAnkleJointLimits: true,
      jointLimitKp: 0.1,
      jointLimitKd: 0.05,

      // Joint posture control
      jointRotationKp: 0.0,
      jointRotationKd: 0.0,

      // Joint limits - Unity values
      hipLimitFreeMin: 0.0,
      hipLimitFreeMax: 60.0,
      kneeLimitFreeMin: 20.0,
      kneeLimitFreeMax: 150.0,
      ankleLimitFreeMin: 20.0,
      ankleLimitFreeMax: 150.0,

      // Rotation stabilization - Unity values
      stabilizeRotation: true,
      targetBodyAngle: 0.0,
      rotationStiffness: 0.1,
      rotationDamping: 0.1,

      // Global physics
      gravityScale: 0.0,
      contactFrictionScale: 1.0,
    };

    game.createSpider(0, 10, testConfig); // Spawn at y=10, ground is at y=15

    // Create scenario: Apply vertical upward pulse to analyze joint forces
    logger.info('Creating scenario...');
    const scenario = new VerticalPulseScenario(2, 0.1); // 2 seconds, 10% vertical input
    logger.info('Scenario:', {
      name: scenario.getName(),
      description: scenario.getDescription(),
      totalSteps: scenario.getTotalSteps()
    });

    // Run simulation
    logger.info('Starting simulation...');
    logger.info('========================================');

    const totalSteps = scenario.getTotalSteps();
    let step = 0;

    while (step < totalSteps) {
      // Get input from scenario
      const input = scenario.getInput(step);

      // Feed input to game
      game.handleInput(input);

      // Step simulation
      game.update();

      step++;

      // Progress feedback every second
      if (step % 60 === 0) {
        const progress = ((step / totalSteps) * 100).toFixed(1);
        logger.info(`Progress: ${step}/${totalSteps} (${progress}%)`, {
          time: game.getTime().toFixed(2) + 's'
        });
      }
    }

    logger.info('========================================');
    logger.info('Simulation complete!', {
      totalSteps: step,
      totalTime: game.getTime().toFixed(2) + 's'
    });

    // Cleanup
    game.destroy();

  } catch (error) {
    logger.error('Simulation failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  } finally {
    // Close logger
    await logger.close();
    console.log('\nLog file written to:', logger.getLogPath());
  }
}

// Run main and handle errors
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
