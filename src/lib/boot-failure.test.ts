import { describe, it, expect } from 'vitest';
import { classifyBootFailure } from './boot-failure';

describe('classifyBootFailure', () => {
  it('recognises a database upgraded by a newer Koinkat', () => {
    // Exactly what sqlx 0.8 reports, passed through by tauri-plugin-sql, when
    // e.g. 0.1.3 (migrations up to 12) opens a database 0.1.4 took to 14.
    expect(
      classifyBootFailure(
        'migration 14 was previously applied but is missing in the resolved migrations',
      ),
    ).toBe('newerVersion');
  });

  it('keeps a modified migration a read failure, not a version problem', () => {
    // A hash mismatch (the CRLF incident) is a broken build, not a newer
    // database; telling the user to upgrade would not help them.
    expect(classifyBootFailure('migration 12 was previously applied but has been modified')).toBe(
      'readFailed',
    );
  });

  it('keeps transient and unknown errors as read failures', () => {
    expect(classifyBootFailure('error returned from database: (code: 5) database is locked')).toBe(
      'readFailed',
    );
    expect(classifyBootFailure('')).toBe('readFailed');
  });
});
