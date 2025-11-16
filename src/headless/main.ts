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

    // Create spider at (0, 5) - above the ground at y=15
    logger.info('Creating spider...');
    game.createSpider(0, 10); // Spawn at y=10, ground is at y=15

    // Create scenario: Hold right for 5 seconds
    logger.info('Creating scenario...');
    const scenario = new HoldRightScenario(5, 1.0); // 5 seconds, full input
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
