/**
 * Version Checker
 *
 * Handles version polling and update detection for cache busting.
 * Works in conjunction with service worker for multi-layered update detection.
 */

interface VersionInfo {
  timestamp: number;
  buildId: string;
}

export class VersionChecker {
  private currentVersion: VersionInfo | null = null;
  private pollingInterval: number | null = null;
  private readonly versionUrl: string;
  private readonly pollIntervalMs: number;
  private onUpdateDetected?: () => void;

  constructor(versionUrl: string = '/cave/version.json', pollIntervalMs: number = 5000) {
    this.versionUrl = versionUrl;
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Set callback for when an update is detected
   */
  setUpdateCallback(callback: () => void): void {
    this.onUpdateDetected = callback;
  }

  /**
   * Check if a new version is available
   */
  async checkForUpdates(): Promise<boolean> {
    try {
      const response = await fetch(this.versionUrl, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        console.warn('Failed to fetch version.json');
        return false;
      }

      const newVersion: VersionInfo = await response.json();

      // First time - store current version
      if (!this.currentVersion) {
        this.currentVersion = newVersion;
        console.log('Current version:', newVersion);
        return false;
      }

      // Check if version changed
      if (newVersion.buildId !== this.currentVersion.buildId ||
          newVersion.timestamp !== this.currentVersion.timestamp) {
        console.log('New version detected!', {
          current: this.currentVersion,
          new: newVersion
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking version:', error);
      return false;
    }
  }

  /**
   * Start polling for version updates
   */
  startPolling(): void {
    // Initial check
    this.checkForUpdates().then(hasUpdate => {
      if (hasUpdate && this.onUpdateDetected) {
        this.onUpdateDetected();
      }
    });

    // Poll at regular intervals
    this.pollingInterval = window.setInterval(async () => {
      const hasUpdate = await this.checkForUpdates();
      if (hasUpdate && this.onUpdateDetected) {
        this.onUpdateDetected();
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling for updates
   */
  stopPolling(): void {
    if (this.pollingInterval !== null) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Show the update button
   */
  static showUpdateButton(): void {
    const updateButton = document.getElementById('update-button');
    if (updateButton && !updateButton.classList.contains('visible')) {
      updateButton.classList.add('visible');
      console.log('Update button shown - new version available!');
    }
  }

  /**
   * Reload the app, clearing all caches
   */
  static reloadApp(): void {
    // Clear all caches and reload
    if ('caches' in window && window.caches) {
      window.caches.keys().then(names => {
        names.forEach(name => window.caches.delete(name));
      }).then(() => {
        window.location.reload();
      });
    } else {
      // No cache API, just reload
      window.location.reload();
    }
  }
}
