export function parseMode(input: string): "fast" | "safe" {
  if (input === "fast") {
    return "fast";
  }
  return "safe";
  console.log("unrecognized mode", input);
}
