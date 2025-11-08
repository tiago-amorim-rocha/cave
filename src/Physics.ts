/**
 * Physics simulation using Matter.js
 * Manages the physics world, cave collision bodies, and player body
 */

import Matter from 'matter-js';
import decomp from 'poly-decomp';
import type { Point } from './PolylineSimplifier';

// Configure Matter.js to use poly-decomp for concave polygon decomposition
(Matter.Common as any).setDecomp(decomp);

export class Physics {
  public engine: Matter.Engine;
  public world: Matter.World;
  private caveBody: Matter.Body | null = null; // Parent body containing all cave parts

  constructor() {
    // Create Matter.js engine
    // Use lighter gravity for game feel (not realistic physics)
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 1 }, // 1 unit/s² - lighter for gameplay
    });
    this.world = this.engine.world;
  }

  /**
   * Update physics simulation
   * @param deltaMs - Time step in milliseconds
   */
  update(deltaMs: number): void {
    // Cap delta to prevent huge jumps (max 33ms = ~30fps minimum)
    const cappedDelta = Math.min(deltaMs, 33);

    // Matter.js expects delta in milliseconds
    Matter.Engine.update(this.engine, cappedDelta);
  }

  /**
   * Create static collision bodies from cave contours
   * Uses a single parent body with multiple parts for efficient management
   * @param contours - Array of polylines representing cave walls
   */
  setCaveContours(contours: Point[][]): void {
    // Remove old cave body if it exists
    if (this.caveBody) {
      Matter.World.remove(this.world, this.caveBody);
      this.caveBody = null;
    }

    if (contours.length === 0) {
      return;
    }

    // Convert contours to Matter.js body parts
    const parts: Matter.Body[] = [];

    for (const contour of contours) {
      if (contour.length < 3) continue;

      // Check if contour is closed (first point equals last point)
      const isClosed =
        Math.abs(contour[0].x - contour[contour.length - 1].x) < 0.001 &&
        Math.abs(contour[0].y - contour[contour.length - 1].y) < 0.001;

      if (isClosed && contour.length >= 4) {
        // Closed contour - create polygon body
        // Remove duplicate last point for Matter.js
        const verts = contour.slice(0, -1).map(p => ({ x: p.x, y: p.y }));

        try {
          // 1) Compute world-space centroid of the polygon
          const center = Matter.Vertices.centre(verts as any);

          // 2) Make a local copy translated around the centroid (vertices relative to body position)
          const local = verts.map(v => ({ x: v.x - center.x, y: v.y - center.y }));

          // 3) Build the body positioned at the centroid with local vertices
          const body = Matter.Bodies.fromVertices(
            center.x, center.y, // Position at centroid
            [local as any],
            {
              isStatic: true,
              friction: 0.3,
              restitution: 0.1,
              label: 'cave-wall-part',
            },
            true // flagInternal - removes collinear points
          );

          if (body) {
            parts.push(body);
          }
        } catch (e) {
          console.warn('Failed to create polygon body from contour:', e);
        }
      } else {
        // Open contour - create chain of edges
        for (let i = 0; i < contour.length - 1; i++) {
          const p1 = contour[i];
          const p2 = contour[i + 1];

          const cx = (p1.x + p2.x) / 2;
          const cy = (p1.y + p2.y) / 2;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          if (length > 0.01) {
            const edge = Matter.Bodies.rectangle(cx, cy, length, 0.1, {
              isStatic: true,
              angle: angle,
              friction: 0.3,
              restitution: 0.1,
              label: 'cave-wall-edge',
            });
            parts.push(edge);
          }
        }
      }
    }

    // Create single parent body with all parts
    if (parts.length > 0) {
      // Create a simple parent body at origin
      const parent = Matter.Body.create({
        isStatic: true,
        friction: 0.3,
        restitution: 0.1,
        label: 'cave-terrain',
      });

      // Combine all parts into the parent body
      Matter.Body.setParts(parent, [parent, ...parts]);

      // Add parent to world
      Matter.World.add(this.world, parent);
      this.caveBody = parent;

      console.log(`Created cave terrain body with ${parts.length} parts from ${contours.length} contours`);
    }
  }

  /**
   * Create player body
   * @param x - Initial X position (metres)
   * @param y - Initial Y position (metres)
   * @returns Player body
   */
  createPlayer(x: number, y: number): Matter.Body {
    const player = Matter.Bodies.circle(x, y, 0.5, {
      isStatic: false,
      friction: 0.3,
      restitution: 0.1,
      density: 0.001, // Density affects mass
      label: 'player',
      // Prevent rotation for easier control
      inertia: Infinity,
    });

    Matter.World.add(this.world, player);
    return player;
  }

  /**
   * Apply horizontal force to player for movement
   */
  applyPlayerMovement(player: Matter.Body, direction: number, force: number = 0.002): void {
    Matter.Body.applyForce(player, player.position, {
      x: direction * force,
      y: 0
    });
  }

  /**
   * Make player jump if grounded
   */
  jumpPlayer(player: Matter.Body, impulse: number = 0.15): void {
    // Check if player is grounded (has collisions below)
    if (this.isGrounded(player)) {
      Matter.Body.setVelocity(player, {
        x: player.velocity.x,
        y: -impulse
      });
    }
  }

  /**
   * Check if player is on the ground
   */
  private isGrounded(player: Matter.Body): boolean {
    // Check for collisions with bodies below the player
    const collisions = Matter.Query.collides(player, Matter.Composite.allBodies(this.world));

    for (const collision of collisions) {
      // Check if collision is roughly below the player
      const normal = collision.normal;
      // Normal pointing upward means ground below
      if (normal.y < -0.5) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all bodies in the world (for rendering debug)
   */
  getAllBodies(): Matter.Body[] {
    return Matter.Composite.allBodies(this.world);
  }
}
