import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { recordedRun } from "../src/demo.mjs";

const WIDTH = 840;
const PAD = 28;
const LINE = 20;
const QUESTION_CHARS = 78;
const FONT =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";

const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const clip = (text, max) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut}…`;
};

export function parseQueue(queue) {
  return queue
    .split(/^(?=## )/m)
    .filter((block) => block.startsWith("## "))
    .map((block) => {
      const [, rank, title, signal, p] = block.match(
        /^## (\d+)\. (.+) · ([a-z_]+@[\d.]+) · P=([\d.]+)$/m,
      );
      const field = (label) =>
        block.match(new RegExp(`^- \\*\\*${label}:\\*\\* (.+)$`, "m"))[1];
      return {
        rank,
        title,
        signal,
        p,
        question: field("Question"),
        answer: field("Jev answer").replace(/\.$/, ""),
      };
    });
}

export function renderDemoSvg({ queue, receipt, result }) {
  const items = parseQueue(queue);
  const count = result.inputTokens.toLocaleString("en-US");
  const bannerOne = `${receipt.model} · ${result.finishedAtUTC.slice(0, 10)} · ${result.succeeded} of ${result.requests} requests answered`;
  const bannerTwo = `${count} input tokens · US$${result.calculatedUSD.toFixed(4)} calculated, not an invoice · synthetic demo app`;
  const top = 44;
  const bannerHeight = 62;
  const itemHeight = 4 * LINE + 18;
  const footerHeight = 44;
  const height =
    top + bannerHeight + items.length * itemHeight + footerHeight + 10;
  const out = [];
  const text = (x, y, fill, body, extra = "") =>
    out.push(
      `<text x="${x}" y="${y}" fill="${fill}"${extra}>${escape(body)}</text>`,
    );

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="t d" font-family="${FONT}" font-size="13">`,
    `<title id="t">jev-scanr queue from a recorded run</title>`,
    `<desc id="d">${escape(`${items.length} candidates from a recorded run on ${receipt.model}, ${result.calculatedUSD.toFixed(4)} US dollars. ${items.map((i) => `${i.rank}. ${i.title}, ${i.signal}, P=${i.p}`).join("; ")}. Hypotheses to verify, not confirmed bugs.`)}</desc>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="#0d1117" stroke="#30363d"/>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="34" rx="10" fill="#161b22"/>`,
    `<rect x="0.5" y="24" width="${WIDTH - 1}" height="11" fill="#161b22"/>`,
    `<line x1="0.5" y1="35" x2="${WIDTH - 0.5}" y2="35" stroke="#30363d"/>`,
    `<circle cx="20" cy="18" r="5.5" fill="#ff5f56"/><circle cx="40" cy="18" r="5.5" fill="#ffbd2e"/><circle cx="60" cy="18" r="5.5" fill="#27c93f"/>`,
  );
  text(
    WIDTH / 2,
    22,
    "#8b949e",
    "queue.md · jevs demo",
    ' text-anchor="middle"',
  );

  const bannerY = top + 12;
  out.push(
    `<rect x="${PAD}" y="${bannerY - 14}" width="112" height="22" rx="4" fill="#9e6a03"/>`,
  );
  text(
    PAD + 56,
    bannerY + 1,
    "#ffffff",
    "RECORDED RUN",
    ' text-anchor="middle" font-weight="700"',
  );
  text(PAD + 128, bannerY + 1, "#c9d1d9", bannerOne);
  text(PAD + 128, bannerY + 1 + LINE, "#8b949e", bannerTwo);

  items.forEach((item, i) => {
    const y = top + bannerHeight + i * itemHeight + 18;
    const pill = `P=${item.p}`;
    const pillWidth = pill.length * 8 + 16;
    text(
      PAD,
      y,
      "#e6edf3",
      `${item.rank}. ${item.title}`,
      ' font-weight="700"',
    );
    out.push(
      `<rect x="${WIDTH - PAD - pillWidth}" y="${y - 15}" width="${pillWidth}" height="22" rx="11" fill="#1f6feb"/>`,
    );
    text(
      WIDTH - PAD - pillWidth / 2,
      y,
      "#ffffff",
      pill,
      ' text-anchor="middle" font-weight="700"',
    );
    text(PAD + 22, y + LINE, "#79c0ff", item.signal);
    text(
      PAD + 22,
      y + 2 * LINE,
      "#8b949e",
      `Question: ${clip(item.question, QUESTION_CHARS)}`,
    );
    text(PAD + 22, y + 3 * LINE, "#8b949e", `Jev answer: ${item.answer}`);
  });

  const footerY = top + bannerHeight + items.length * itemHeight + 22;
  out.push(
    `<line x1="${PAD}" y1="${footerY - 18}" x2="${WIDTH - PAD}" y2="${footerY - 18}" stroke="#30363d"/>`,
  );
  text(
    PAD,
    footerY,
    "#8b949e",
    "Hypotheses to verify before editing, not confirmed bugs. Questions clipped.",
  );
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

export const IMAGE_PATH = new URL(
  "../docs/images/demo-queue.svg",
  import.meta.url,
);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(IMAGE_PATH, renderDemoSvg(recordedRun()));
  console.log(`wrote ${IMAGE_PATH.pathname}`);
}
