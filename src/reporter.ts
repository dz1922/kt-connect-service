import ora, { Ora } from 'ora';
import chalk from 'chalk';

export type Level = 'info' | 'success' | 'warn' | 'error' | 'debug';

class Reporter {
  private spinner: Ora | null = null;
  private verbose = false;

  setVerbose(v: boolean): void {
    this.verbose = v;
  }

  startStep(text: string): void {
    this.stopSpinner();
    this.spinner = ora(text).start();
  }

  updateStep(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    } else {
      this.log('info', text);
    }
  }

  succeedStep(text?: string): void {
    if (this.spinner) {
      this.spinner.succeed(text);
      this.spinner = null;
    } else if (text) {
      this.log('success', text);
    }
  }

  failStep(text?: string): void {
    if (this.spinner) {
      this.spinner.fail(text);
      this.spinner = null;
    } else if (text) {
      this.log('error', text);
    }
  }

  log(level: Level, message: string): void {
    if (level === 'debug' && !this.verbose) return;

    // If spinner is active, use stopAndPersist to safely interleave output
    if (this.spinner?.isSpinning) {
      const symbol = this.symbol(level);
      this.spinner.stopAndPersist({ symbol, text: message });
      this.spinner.start();
      return;
    }

    const prefix = this.symbol(level);
    console.log(prefix + ' ' + message);
  }

  reset(): void {
    this.stopSpinner();
    this.verbose = false;
  }

  private symbol(level: Level): string {
    switch (level) {
      case 'success': return chalk.green('✓');
      case 'warn': return chalk.yellow('⚠');
      case 'error': return chalk.red('✖');
      case 'debug': return chalk.gray('·');
      case 'info':
      default: return chalk.blue('ℹ');
    }
  }

  private stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}

export const reporter = new Reporter();
