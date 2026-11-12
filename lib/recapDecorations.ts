export const recapDecorations = {
  intro: ["shoe.svg", "running.svg"],
  finisher: ["finisher-card.svg"],
  distance: ["medal.svg", "music.svg"],
  splits: ["watch-pace.svg"],
  context: ["watch.svg", "runner-era-card.svg"],
  photos: ["glasses.svg"],
  share: ["two-finish.svg"],
} as const;

export function decorationUrl(file: string) {
  return `/decorations/funky/${file}`;
}
