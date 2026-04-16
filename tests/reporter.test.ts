import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ora before importing reporter
const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stopAndPersist: vi.fn().mockReturnThis(),
  isSpinning: false,
  text: '',
};

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

import { reporter } from '../src/reporter';

describe('Reporter', () => {
  beforeEach(() => {
    reporter.reset();
    vi.clearAllMocks();
    mockSpinner.isSpinning = false;
    mockSpinner.text = '';
  });

  describe('log', () => {
    it('should print info messages', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      reporter.log('info', 'test message');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('test message'));
      spy.mockRestore();
    });

    it('should suppress debug messages when verbose is off', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      reporter.log('debug', 'hidden message');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should show debug messages when verbose is on', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      reporter.setVerbose(true);
      reporter.log('debug', 'visible message');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('visible message'));
      spy.mockRestore();
    });

    it('should use stopAndPersist when spinner is active', () => {
      reporter.startStep('working');
      mockSpinner.isSpinning = true;
      reporter.log('info', 'interleaved');
      expect(mockSpinner.stopAndPersist).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'interleaved' })
      );
      expect(mockSpinner.start).toHaveBeenCalled();
    });
  });

  describe('spinner lifecycle', () => {
    it('should start and succeed a step', () => {
      reporter.startStep('loading');
      expect(mockSpinner.start).toHaveBeenCalled();
      reporter.succeedStep('done');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('done');
    });

    it('should start and fail a step', () => {
      reporter.startStep('loading');
      reporter.failStep('error occurred');
      expect(mockSpinner.fail).toHaveBeenCalledWith('error occurred');
    });

    it('should update spinner text', () => {
      reporter.startStep('initial');
      reporter.updateStep('new text');
      expect(mockSpinner.text).toBe('new text');
    });

    it('failStep without spinner should log error', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      reporter.failStep('standalone error');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('standalone error'));
      spy.mockRestore();
    });
  });

  describe('reset', () => {
    it('should stop spinner and reset verbose', () => {
      reporter.setVerbose(true);
      reporter.startStep('test');
      reporter.reset();

      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      reporter.log('debug', 'should be hidden after reset');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
