import type { ProductDecisionProfile } from "../types";

export function buildVisualDifferences(profiles: ProductDecisionProfile[]): string[] {
  if (profiles.length < 2) return [];
  const sortedByBold = [...profiles].sort(
    (a, b) => b.imageSignals.visualBoldness - a.imageSignals.visualBoldness
  );
  const sortedByStructure = [...profiles].sort(
    (a, b) => b.imageSignals.structureLevel - a.imageSignals.structureLevel
  );

  const notes: string[] = [];
  const topBold = sortedByBold[0];
  const lowBold = sortedByBold[sortedByBold.length - 1];
  if (topBold.imageSignals.visualBoldness - lowBold.imageSignals.visualBoldness > 0.18) {
    notes.push(
      `${topBold.title} reads bolder at first glance, while ${lowBold.title} feels calmer and easier to style day to day.`
    );
  }

  const topStructure = sortedByStructure[0];
  const lowStructure = sortedByStructure[sortedByStructure.length - 1];
  if (topStructure.imageSignals.structureLevel - lowStructure.imageSignals.structureLevel > 0.16) {
    notes.push(
      `${topStructure.title} has a cleaner, more structured shape, while ${lowStructure.title} drapes softer with a more relaxed vibe.`
    );
  }

  if (notes.length === 0) {
    notes.push("These pieces look quite close visually, so your best choice comes down to comfort, styling habits, and personal vibe.");
  }

  return notes;
}
