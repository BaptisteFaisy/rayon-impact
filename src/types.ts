/**
 * Barrel of the domain types. Every module imports from here so the split
 * between core domain types and collected-data types stays invisible.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
export * from './types/core';
export * from './types/collected';
