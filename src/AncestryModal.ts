/**
 * AncestryModal
 *
 * Modal UI for displaying segment ancestry information from stitched loops.
 * Shows detailed data about which source loops and canonical vertices
 * each segment came from.
 */

import type { SegmentAncestry } from './TerrainSurgery';
import type { OptVertex } from './terrain/CanonicalGeometry';

export interface AncestryModalData {
  stitchedLoopId: number;
  segmentIndex: number;
  ancestry: SegmentAncestry;
  stitchedVertexCount: number;

  /** For cold (boundary) segments: the related optimized vertices from the canonical loop */
  relatedOptVertices?: Array<{
    index: number;
    vertex: OptVertex;
  }>;
}

export class AncestryModal {
  private modal: HTMLDivElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private currentData: AncestryModalData | null = null;

  constructor() {
    this.createModal();
  }

  /**
   * Create the modal DOM structure
   */
  private createModal(): void {
    // Create overlay (darkened background)
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      z-index: 9999;
      backdrop-filter: blur(4px);
    `;

    // Create modal container
    this.modal = document.createElement('div');
    this.modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #1a1a1a;
      border: 2px solid #4a4a4a;
      border-radius: 12px;
      padding: 24px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
      z-index: 10000;
      color: #ffffff;
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 14px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      display: none;
    `;

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: #ff4444;
      color: white;
      border: none;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    `;
    closeButton.onmouseover = () => closeButton.style.background = '#ff6666';
    closeButton.onmouseout = () => closeButton.style.background = '#ff4444';
    closeButton.onclick = () => this.hide();

    this.modal.appendChild(closeButton);

    // Add to document
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.modal);

    // Close on overlay click
    this.overlay.onclick = () => this.hide();
  }

  /**
   * Show the modal with ancestry data
   */
  show(data: AncestryModalData): void {
    if (!this.modal || !this.overlay) return;

    this.currentData = data;
    this.renderContent();

    this.overlay.style.display = 'block';
    this.modal.style.display = 'block';
  }

  /**
   * Hide the modal
   */
  hide(): void {
    if (!this.modal || !this.overlay) return;

    this.overlay.style.display = 'none';
    this.modal.style.display = 'none';
    this.currentData = null;
  }

  /**
   * Check if modal is currently visible
   */
  isVisible(): boolean {
    return this.modal?.style.display === 'block';
  }

  /**
   * Render the modal content
   */
  private renderContent(): void {
    if (!this.modal || !this.currentData) return;

    const { stitchedLoopId, segmentIndex, ancestry, stitchedVertexCount } = this.currentData;

    // Clear existing content (except close button)
    while (this.modal.children.length > 1) {
      this.modal.removeChild(this.modal.lastChild!);
    }

    // Title
    const title = document.createElement('h2');
    title.textContent = `Segment Ancestry`;
    title.style.cssText = `
      margin: 0 0 20px 0;
      font-size: 24px;
      color: #00ffff;
      font-weight: bold;
    `;
    this.modal.appendChild(title);

    // Stitched loop info
    const loopInfo = this.createSection('Stitched Loop', [
      { label: 'Loop ID', value: `#${stitchedLoopId}` },
      { label: 'Segment Index', value: `${segmentIndex}` },
      { label: 'Total Vertices in Loop', value: `${stitchedVertexCount}` }
    ], '#ffff00');
    this.modal.appendChild(loopInfo);

    // Source loop info
    const sourceColor = ancestry.isNew ? '#ff4500' : '#00bfff';
    const sourceType = ancestry.isNew ? 'New (Warm)' : 'Boundary (Cold)';
    const sourceInfo = this.createSection('Source Loop', [
      { label: 'Source Loop ID', value: `${ancestry.sourceLoopId}` },
      { label: 'Type', value: sourceType },
      { label: 'Original Vertex Count', value: `${ancestry.originalVertices.length}` }
    ], sourceColor);
    this.modal.appendChild(sourceInfo);

    // Vertex range in stitched loop
    const rangeInfo = this.createSection('Position in Stitched Loop', [
      { label: 'Vertex Range', value: `[${ancestry.vertexRange[0]}, ${ancestry.vertexRange[1]}]` },
      { label: 'Vertex Count', value: `${ancestry.vertexRange[1] - ancestry.vertexRange[0] + 1}` }
    ], '#00ff00');
    this.modal.appendChild(rangeInfo);

    // Canonical loop info (for boundary arcs)
    if (ancestry.sourceCanonicalId !== undefined) {
      const canonicalInfo = this.createSection('Canonical Loop (Original)', [
        { label: 'Canonical Loop ID', value: `${ancestry.sourceCanonicalId}` },
        {
          label: 'Canonical Vertex ID Range',
          value: ancestry.canonicalEndpointIds
            ? `[${ancestry.canonicalEndpointIds[0]}, ${ancestry.canonicalEndpointIds[1]}]`
            : 'N/A'
        }
      ], '#ff00ff');
      this.modal.appendChild(canonicalInfo);

      // Show optimization summary (if available)
      if (this.currentData.relatedOptVertices && this.currentData.relatedOptVertices.length > 0) {
        const relatedOpts = this.currentData.relatedOptVertices;
        const optIndices = relatedOpts.map(v => v.index);
        const minOptIdx = Math.min(...optIndices);
        const maxOptIdx = Math.max(...optIndices);

        // Calculate canonical vertex count in ID range
        const canonicalIdRange = ancestry.canonicalEndpointIds!;
        const canonicalCount = canonicalIdRange[1] - canonicalIdRange[0] + 1;
        const optCount = relatedOpts.length;
        const changePercent = ((optCount - canonicalCount) / canonicalCount * 100).toFixed(1);
        const changeSign = optCount > canonicalCount ? '+' : '';

        const optimizationSummary = this.createSection('Optimization Pipeline Result', [
          { label: 'Optimized Vertex Range', value: `[${minOptIdx}, ${maxOptIdx}]` },
          { label: 'Optimized Vertex Count', value: `${optCount}` },
          { label: 'Canonical Vertex Count', value: `${canonicalCount}` },
          { label: 'Change', value: `${changeSign}${changePercent}% (${changeSign}${optCount - canonicalCount} vertices)` }
        ], '#ffa500');
        this.modal.appendChild(optimizationSummary);

        const optVerticesSection = this.createExpandableOptVerticesList(
          this.currentData.relatedOptVertices
        );
        this.modal.appendChild(optVerticesSection);
      }
    }

    // Expandable vertex list
    const vertexList = this.createExpandableVertexList(ancestry.originalVertices);
    this.modal.appendChild(vertexList);
  }

  /**
   * Create a section with label-value pairs
   */
  private createSection(
    title: string,
    items: Array<{ label: string; value: string }>,
    color: string
  ): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = `
      margin-bottom: 20px;
      padding: 16px;
      background: #2a2a2a;
      border-left: 4px solid ${color};
      border-radius: 4px;
    `;

    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      margin: 0 0 12px 0;
      font-size: 18px;
      color: ${color};
      font-weight: bold;
    `;
    section.appendChild(sectionTitle);

    items.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        padding: 4px 0;
      `;

      const label = document.createElement('span');
      label.textContent = `${item.label}:`;
      label.style.cssText = `
        color: #aaaaaa;
        font-weight: normal;
      `;

      const value = document.createElement('span');
      value.textContent = item.value;
      value.style.cssText = `
        color: #ffffff;
        font-weight: bold;
      `;

      row.appendChild(label);
      row.appendChild(value);
      section.appendChild(row);
    });

    return section;
  }

  /**
   * Create an expandable list of vertices
   */
  private createExpandableVertexList(vertices: Array<{ x: number; y: number }>): HTMLDivElement {
    const container = document.createElement('div');
    container.style.cssText = `
      margin-bottom: 20px;
      padding: 16px;
      background: #2a2a2a;
      border-left: 4px solid #00ff88;
      border-radius: 4px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      margin-bottom: 12px;
    `;

    const title = document.createElement('h3');
    title.textContent = `Vertices (${vertices.length})`;
    title.style.cssText = `
      margin: 0;
      font-size: 18px;
      color: #00ff88;
      font-weight: bold;
    `;

    const toggleIcon = document.createElement('span');
    toggleIcon.textContent = '▼';
    toggleIcon.style.cssText = `
      font-size: 16px;
      color: #00ff88;
      transition: transform 0.2s;
    `;

    header.appendChild(title);
    header.appendChild(toggleIcon);

    const content = document.createElement('div');
    content.style.cssText = `
      max-height: 300px;
      overflow-y: auto;
      padding: 8px;
      background: #1a1a1a;
      border-radius: 4px;
    `;

    // Populate vertex list
    vertices.forEach((v, i) => {
      const vertexRow = document.createElement('div');
      vertexRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        padding: 4px 8px;
        margin-bottom: 4px;
        background: ${i % 2 === 0 ? '#222' : '#2a2a2a'};
        border-radius: 2px;
        font-size: 12px;
      `;

      const index = document.createElement('span');
      index.textContent = `[${i}]`;
      index.style.color = '#888';

      const coords = document.createElement('span');
      coords.textContent = `(${v.x.toFixed(3)}, ${v.y.toFixed(3)})`;
      coords.style.color = '#fff';

      vertexRow.appendChild(index);
      vertexRow.appendChild(coords);
      content.appendChild(vertexRow);
    });

    // Toggle functionality
    let isExpanded = true;
    const toggle = () => {
      isExpanded = !isExpanded;
      content.style.display = isExpanded ? 'block' : 'none';
      toggleIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    };

    header.onclick = toggle;

    container.appendChild(header);
    container.appendChild(content);

    return container;
  }

  /**
   * Create an expandable list of optimized vertices with ancestry info
   */
  private createExpandableOptVerticesList(
    optVertices: Array<{ index: number; vertex: OptVertex }>
  ): HTMLDivElement {
    const container = document.createElement('div');
    container.style.cssText = `
      margin-bottom: 20px;
      padding: 16px;
      background: #2a2a2a;
      border-left: 4px solid #ffa500;
      border-radius: 4px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      margin-bottom: 12px;
    `;

    const title = document.createElement('h3');
    title.textContent = `Related Optimized Vertices (${optVertices.length})`;
    title.style.cssText = `
      margin: 0;
      font-size: 18px;
      color: #ffa500;
      font-weight: bold;
    `;

    const toggleIcon = document.createElement('span');
    toggleIcon.textContent = '▼';
    toggleIcon.style.cssText = `
      font-size: 16px;
      color: #ffa500;
      transition: transform 0.2s;
    `;

    header.appendChild(title);
    header.appendChild(toggleIcon);

    const content = document.createElement('div');
    content.style.cssText = `
      max-height: 300px;
      overflow-y: auto;
      padding: 8px;
      background: #1a1a1a;
      border-radius: 4px;
    `;

    // Populate optimized vertex list
    optVertices.forEach(({ index, vertex }, i) => {
      const vertexRow = document.createElement('div');
      vertexRow.style.cssText = `
        display: flex;
        flex-direction: column;
        padding: 8px;
        margin-bottom: 4px;
        background: ${i % 2 === 0 ? '#222' : '#2a2a2a'};
        border-radius: 2px;
        font-size: 12px;
      `;

      // First row: index and coordinates
      const firstRow = document.createElement('div');
      firstRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
      `;

      const indexSpan = document.createElement('span');
      indexSpan.textContent = `[${index}]`;
      indexSpan.style.color = '#ffa500';
      indexSpan.style.fontWeight = 'bold';

      const coords = document.createElement('span');
      coords.textContent = `(${vertex.x.toFixed(3)}, ${vertex.y.toFixed(3)})`;
      coords.style.color = '#fff';

      firstRow.appendChild(indexSpan);
      firstRow.appendChild(coords);

      // Second row: ancestry range
      const secondRow = document.createElement('div');
      secondRow.style.cssText = `
        display: flex;
        justify-content: flex-start;
        gap: 8px;
        font-size: 11px;
      `;

      const ancestryLabel = document.createElement('span');
      ancestryLabel.textContent = 'Canon ID Range:';
      ancestryLabel.style.color = '#888';

      const ancestryRange = document.createElement('span');
      ancestryRange.textContent = `[${vertex.canonStartId}, ${vertex.canonEndId}]`;
      ancestryRange.style.color = '#ff00ff';
      ancestryRange.style.fontWeight = 'bold';

      secondRow.appendChild(ancestryLabel);
      secondRow.appendChild(ancestryRange);

      vertexRow.appendChild(firstRow);
      vertexRow.appendChild(secondRow);
      content.appendChild(vertexRow);
    });

    // Toggle functionality
    let isExpanded = true;
    const toggle = () => {
      isExpanded = !isExpanded;
      content.style.display = isExpanded ? 'block' : 'none';
      toggleIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    };

    header.onclick = toggle;

    container.appendChild(header);
    container.appendChild(content);

    return container;
  }

  /**
   * Destroy the modal and remove from DOM
   */
  destroy(): void {
    if (this.modal) {
      document.body.removeChild(this.modal);
      this.modal = null;
    }
    if (this.overlay) {
      document.body.removeChild(this.overlay);
      this.overlay = null;
    }
  }
}
