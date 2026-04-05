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
      `${topBold.title} reads more visually assertive than ${lowBold.title}, creating stronger style expression but lower neutrality.`
    );
  }

  const topStructure = sortedByStructure[0];
  const lowStructure = sortedByStructure[sortedByStructure.length - 1];
  if (topStructure.imageSignals.structureLevel - lowStructure.imageSignals.structureLevel > 0.16) {
    notes.push(
      `${topStructure.title} has a more structured silhouette, while ${lowStructure.title} leans softer and less formal.`
    );
  }

  if (notes.length === 0) {
    notes.push("Visual language is close across selected items, so practical and identity factors drive most differentiation.");
  }

  return notes;
}
