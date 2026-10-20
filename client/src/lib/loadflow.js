// The load-flow engine now lives in ./engine/ (one module per concern — see engine/index.js).
// This file is kept as the stable public entry point: every page, the report and the diagram
// import from here, and must keep working unchanged (brief rule 4).
export * from './engine/index.js';
