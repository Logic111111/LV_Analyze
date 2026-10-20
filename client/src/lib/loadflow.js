// The load-flow engine lives in packages/engine/ (P7.1), shared by this client (Vite alias, and a
// file: dependency so plain Node scripts resolve it too) and the server (dynamic import). This
// file is kept as the stable public entry point: every page, the report and the diagram import
// from here, and must keep working unchanged (brief rule 4).
export * from '@feeder-island/engine';
