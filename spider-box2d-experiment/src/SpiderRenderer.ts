/**
 * Spider Renderer for Canvas2D
 * Simple visualization of spider rig
 */

/**
 * Spider Renderer
 *
 * Draws spider using Canvas2D:
 * - Body as square
 * - Segments as rectangles
 * - Feet as small squares
 * - Joints as circles
 */
export class SpiderRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private scale: number = 50; // pixels per metre
  private offsetX: number = 0;
  private offsetY: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;

    // Center camera on canvas
    this.offsetX = canvas.width / 2;
    this.offsetY = canvas.height / 2;
  }

  /**
   * Set camera scale (pixels per metre)
   */
  setScale(scale: number): void {
    this.scale = scale;
  }

  /**
   * Set camera offset (pixels)
   */
  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: x * this.scale + this.offsetX,
      y: -y * this.scale + this.offsetY, // Flip Y axis (screen Y goes down)
    };
  }

  /**
   * Clear canvas
   */
  clear(): void {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Draw spider using render data
   */
  drawSpider(renderData: any): void {
    // Draw legs first (behind body)
    this.drawLeg(renderData.leftLeg, '#00ff00');
    this.drawLeg(renderData.rightLeg, '#00ff00');

    // Draw body last (in front)
    this.drawBody(renderData.body);
  }

  /**
   * Draw spider body
   */
  private drawBody(bodyData: any): void {
    const pos = this.worldToScreen(bodyData.x, bodyData.y);
    const width = bodyData.width * this.scale;
    const height = bodyData.height * this.scale;

    this.ctx.save();
    this.ctx.translate(pos.x, pos.y);
    this.ctx.rotate(-bodyData.angle); // Negative because screen Y is flipped

    // Draw body as square
    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(-width / 2, -height / 2, width, height);

    // Draw outline
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(-width / 2, -height / 2, width, height);

    this.ctx.restore();
  }

  /**
   * Draw a single leg (3 segments + foot)
   */
  private drawLeg(legData: any, color: string): void {
    // Draw segments
    this.drawSegment(legData.hip, color);
    this.drawSegment(legData.knee, color);
    this.drawSegment(legData.ankle, color);

    // Draw foot
    this.drawFoot(legData.foot);

    // Draw joints
    this.drawJoint(legData.hip.x, legData.hip.y);
    this.drawJoint(
      legData.hip.x + legData.hip.length * Math.cos(legData.hip.angle),
      legData.hip.y + legData.hip.length * Math.sin(legData.hip.angle)
    );
    this.drawJoint(
      legData.knee.x + legData.knee.length * Math.cos(legData.knee.angle),
      legData.knee.y + legData.knee.length * Math.sin(legData.knee.angle)
    );
    this.drawJoint(
      legData.ankle.x + legData.ankle.length * Math.cos(legData.ankle.angle),
      legData.ankle.y + legData.ankle.length * Math.sin(legData.ankle.angle)
    );
  }

  /**
   * Draw a segment (rectangle)
   */
  private drawSegment(segmentData: any, color: string): void {
    const pos = this.worldToScreen(segmentData.x, segmentData.y);
    const length = segmentData.length * this.scale;
    const width = segmentData.width * this.scale;

    this.ctx.save();
    this.ctx.translate(pos.x, pos.y);
    this.ctx.rotate(-segmentData.angle); // Negative because screen Y is flipped

    // Draw segment as rectangle
    this.ctx.fillStyle = color;
    this.ctx.fillRect(-length / 2, -width / 2, length, width);

    // Draw outline
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(-length / 2, -width / 2, length, width);

    this.ctx.restore();
  }

  /**
   * Draw a joint (circle)
   */
  private drawJoint(x: number, y: number): void {
    const pos = this.worldToScreen(x, y);

    this.ctx.fillStyle = '#ffff00';
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  /**
   * Draw foot (small square)
   */
  private drawFoot(footData: any): void {
    const pos = this.worldToScreen(footData.x, footData.y);
    const size = 0.2 * this.scale;

    this.ctx.fillStyle = '#ff00ff';
    this.ctx.fillRect(pos.x - size / 2, pos.y - size / 2, size, size);

    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(pos.x - size / 2, pos.y - size / 2, size, size);
  }

  /**
   * Draw ground reference line
   */
  drawGround(y: number): void {
    const left = this.worldToScreen(-10, y);
    const right = this.worldToScreen(10, y);

    this.ctx.strokeStyle = '#444444';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([10, 5]);
    this.ctx.beginPath();
    this.ctx.moveTo(left.x, left.y);
    this.ctx.lineTo(right.x, right.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  /**
   * Draw grid for reference
   */
  drawGrid(spacing: number = 1): void {
    const gridColor = '#222222';
    this.ctx.strokeStyle = gridColor;
    this.ctx.lineWidth = 1;

    // Vertical lines
    for (let x = -10; x <= 10; x += spacing) {
      const top = this.worldToScreen(x, 10);
      const bottom = this.worldToScreen(x, -10);
      this.ctx.beginPath();
      this.ctx.moveTo(top.x, top.y);
      this.ctx.lineTo(bottom.x, bottom.y);
      this.ctx.stroke();
    }

    // Horizontal lines
    for (let y = -10; y <= 10; y += spacing) {
      const left = this.worldToScreen(-10, y);
      const right = this.worldToScreen(10, y);
      this.ctx.beginPath();
      this.ctx.moveTo(left.x, left.y);
      this.ctx.lineTo(right.x, right.y);
      this.ctx.stroke();
    }
  }
}
