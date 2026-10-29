// Vite's ?raw imports (text files bundled into the Worker).
declare module "*?raw" {
  const text: string;
  export default text;
}
