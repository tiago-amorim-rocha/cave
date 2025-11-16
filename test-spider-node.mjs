/**
 * Standalone Node.js spider test
 * Runs spider physics simulation without browser
 */

import RAPIER from '@dimforge/rapier2d-compat';

// Wait for RAPIER to initialize
await RAPIER.init();

console.log('=== RAPIER INITIALIZED ===');
console.log('Version:', RAPIER.version());

// Create physics world
const world = new RAPIER.World({ x: 0, y: 10.0 }); // Gravity: Y-down = +10
console.log('Physics world created with gravity (0, 10)');

// Create simple test: single body with torque
const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
  .setTranslation(0, 0)
  .setAngularDamping(0.05);

const body = world.createRigidBody(bodyDesc);

const collider = RAPIER.ColliderDesc.cuboid(0.5, 0.5)
  .setDensity(1.0);

world.createCollider(collider, body);

console.log('Created test body: mass =', body.mass());

// Simulate 100 frames
const dt = 1.0 / 60.0; // 60 Hz

for (let frame = 1; frame <= 100; frame++) {
  // Reset forces
  body.resetForces(true);

  // Apply asymmetric torque to test angular damping
  if (frame <= 10) {
    body.addTorque(0.1, true);

    if (frame === 1 || frame === 5 || frame === 10) {
      const angVel = body.angvel();
      const rot = body.rotation();
      console.log(`Frame ${frame}: torque=0.1, angVel=${angVel.toFixed(6)} rad/s, rotation=${(rot * 180 / Math.PI).toFixed(3)}°`);
    }
  }

  // Step physics
  world.step();
}

console.log('\n=== TEST COMPLETE ===');
console.log('This confirms RAPIER works in Node.js');
console.log('Now we need to port full spider controller to run here...');
