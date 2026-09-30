export function parseMode(input: string): "fast" | "safe" {
  if (input === "fast") {
    return "fast";
  }
  console.log("unrecognized mode", input);
  return "safe";
}
