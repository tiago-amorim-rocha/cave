import type { CarvingDebugHost } from '../../carving/CarvingDebugHooks';
import { CarvingDebugController } from './CarvingDebugController';

function createCarvingStepButton(onAdvance: () => void): HTMLButtonElement {
  const stitchButton = document.createElement('button');
  stitchButton.id = 'stitch-button';
  stitchButton.textContent = '▶️';
  stitchButton.title = 'Advance carving debug';
  stitchButton.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 100px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: #444;
    color: #fff;
    font-size: 24px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 9999;
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  `;

  stitchButton.addEventListener('click', onAdvance);
  stitchButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    onAdvance();
  });

  document.body.appendChild(stitchButton);
  return stitchButton;
}

export function installCarvingDebug(app: CarvingDebugHost): { dispose: () => void } {
  const controller = new CarvingDebugController(app.getCarvingDebugContext());
  app.setCarvingDebugHooks(controller);

  const button = createCarvingStepButton(() => controller.advanceStep());

  return {
    dispose: () => {
      button.remove();
      controller.dispose();
      app.setCarvingDebugHooks(null);
    }
  };
}

