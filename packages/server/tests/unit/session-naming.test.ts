import { describe, it, expect } from 'vitest';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';

describe('SessionNamingService', () => {
  const service = new SessionNamingService();

  describe('generateShellName', () => {
    it('should generate names with asm_shell_ prefix', () => {
      const name = service.generateShellName('/tmp/test');
      expect(name).toMatch(/^asm_shell_[a-f0-9]{8}$/);
    });

    it('should generate unique names for same cwd', () => {
      const name1 = service.generateShellName('/tmp/test');
      const name2 = service.generateShellName('/tmp/test');
      expect(name1).not.toBe(name2);
    });
  });

  describe('generateClaudeName', () => {
    it('should generate names with asm_claude_ prefix', () => {
      const name = service.generateClaudeName('/tmp/test');
      expect(name).toMatch(/^asm_claude_[a-f0-9]{8}$/);
    });

    it('should be deterministic for same cwd', () => {
      const name1 = service.generateClaudeName('/tmp/test');
      const name2 = service.generateClaudeName('/tmp/test');
      expect(name1).toBe(name2);
    });

    it('should differ for different cwds', () => {
      const name1 = service.generateClaudeName('/tmp/test1');
      const name2 = service.generateClaudeName('/tmp/test2');
      expect(name1).not.toBe(name2);
    });
  });

  describe('isManaged', () => {
    it('should return true for asm_ prefixed names', () => {
      expect(service.isManaged('asm_shell_abc12345')).toBe(true);
      expect(service.isManaged('asm_claude_abc12345')).toBe(true);
    });

    it('should return false for non-asm names', () => {
      expect(service.isManaged('my-session')).toBe(false);
      expect(service.isManaged('0')).toBe(false);
    });
  });

  describe('parseType', () => {
    it('should parse shell type', () => {
      expect(service.parseType('asm_shell_abc12345')).toBe('shell');
    });

    it('should parse claude type', () => {
      expect(service.parseType('asm_claude_abc12345')).toBe('claude');
    });

    it('should return null for unknown', () => {
      expect(service.parseType('asm_unknown_abc')).toBeNull();
      expect(service.parseType('other')).toBeNull();
    });
  });
});
