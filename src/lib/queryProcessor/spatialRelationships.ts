/**
 * Spatial Relationship Handler
 *
 * Parses and extracts spatial relationship constraints from user prompts.
 * Handles patterns like:
 * - "pattern on the sleeves"
 * - "stripes on the collar"
 * - "embroidery at the back"
 * - "buttons down the front"
 * - "pocket on the chest"
 */

export interface SpatialConstraint {
  attribute: string;         // What attribute (e.g., "stripes", "embroidery", "pocket")
  attributeType: string;     // Type (pattern, detail, color, etc.)
  location: string;          // Where on the garment (e.g., "sleeves", "collar", "back")
  locationType: string;      // Type of location (garment_part, position, area)
  relationship: string;      // Spatial relationship (on, at, across, down, around)
  confidence: number;        // Confidence in this constraint
  originalPhrase: string;    // Original text
}

export interface SpatialParseResult {
  spatialConstraints: SpatialConstraint[];
  hasSpatial: boolean;
  cleanedPrompt: string;
}

// ─── Garment Parts Dictionary ────────────────────────────────────────────────

const GARMENT_PARTS = {
  // Upper body parts
  sleeves: ['sleeve', 'sleeves', 'cuff', 'cuffs', 'arm', 'arms'],
  collar: ['collar', 'neckline', 'neck'],
  shoulders: ['shoulder', 'shoulders', 'shoulder seam'],
  chest: ['chest', 'bust', 'breast'],
  back: ['back', 'rear', 'behind'],
  front: ['front', 'face', 'forward'],

  // Lower body parts
  waist: ['waist', 'waistband', 'belt line'],
  hem: ['hem', 'hemline', 'bottom edge'],
  legs: ['leg', 'legs', 'thigh', 'thighs', 'knee', 'knees'],
  pockets: ['pocket', 'pockets', 'pocket area'],

  // Details and accents
  sides: ['side', 'sides', 'lateral'],
  seams: ['seam', 'seams', 'stitching line'],
  trim: ['trim', 'trimming', 'edge', 'edges'],
  panel: ['panel', 'panels', 'section', 'sections'],
};

// Flat list for pattern matching
const ALL_GARMENT_PARTS = Object.values(GARMENT_PARTS).flat();

// ─── Spatial Prepositions ─────────────────────────────────────────────────────

const SPATIAL_PREPOSITIONS = [
  'on', 'at', 'across', 'down', 'up', 'along', 'around', 'over', 'under', 'near',
  'by', 'beside', 'through', 'throughout', 'within', 'inside', 'outside'
];

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse spatial relationship constraints from user prompt
 */
export function parseSpatialRelationships(userPrompt: string): SpatialParseResult {
  const constraints: SpatialConstraint[] = [];
  let cleanedPrompt = userPrompt;

  // Pattern: [attribute] [preposition] the [location]
  // Examples: "stripes on the sleeves", "embroidery at the collar"
  const pattern1 = new RegExp(
    `\\b([a-z]+(?:\\s+[a-z]+)?)\\s+(${SPATIAL_PREPOSITIONS.join('|')})\\s+(?:the\\s+)?(${ALL_GARMENT_PARTS.join('|')})\\b`,
    'gi'
  );

  let match: RegExpExecArray | null;
  while ((match = pattern1.exec(userPrompt)) !== null) {
    const attribute = match[1].trim();
    const relationship = match[2].toLowerCase();
    const location = match[3].toLowerCase();

    constraints.push({
      attribute,
      attributeType: inferAttributeType(attribute),
      location,
      locationType: inferLocationType(location),
      relationship,
      confidence: 0.9,
      originalPhrase: match[0]
    });

    // Remove from cleaned prompt
    cleanedPrompt = cleanedPrompt.replace(match[0], '').trim();
  }

  // Pattern: [location] [attribute]
  // Examples: "sleeve stripes", "collar embroidery"
  const pattern2 = new RegExp(
    `\\b(${ALL_GARMENT_PARTS.join('|')})\\s+([a-z]+(?:\\s+[a-z]+)?)\\b`,
    'gi'
  );

  pattern2.lastIndex = 0; // Reset regex
  while ((match = pattern2.exec(userPrompt)) !== null) {
    const location = match[1].toLowerCase();
    const attribute = match[2].trim();

    // Check if already captured by pattern1
    const isDuplicate = constraints.some(c =>
      c.attribute.toLowerCase() === attribute.toLowerCase() &&
      c.location.toLowerCase() === location.toLowerCase()
    );

    if (!isDuplicate && isValidAttributeForSpatial(attribute)) {
      constraints.push({
        attribute,
        attributeType: inferAttributeType(attribute),
        location,
        locationType: inferLocationType(location),
        relationship: 'on', // implicit "on"
        confidence: 0.85,
        originalPhrase: match[0]
      });

      // Remove from cleaned prompt
      cleanedPrompt = cleanedPrompt.replace(match[0], '').trim();
    }
  }

  // Pattern: [attribute] [preposition] [location] (without "the")
  // Examples: "pattern on sleeves", "buttons down front"
  const pattern3 = new RegExp(
    `\\b([a-z]+(?:\\s+[a-z]+)?)\\s+(${SPATIAL_PREPOSITIONS.join('|')})\\s+(${ALL_GARMENT_PARTS.join('|')})\\b`,
    'gi'
  );

  pattern3.lastIndex = 0;
  while ((match = pattern3.exec(userPrompt)) !== null) {
    const attribute = match[1].trim();
    const relationship = match[2].toLowerCase();
    const location = match[3].toLowerCase();

    // Check if already captured
    const isDuplicate = constraints.some(c =>
      c.attribute.toLowerCase() === attribute.toLowerCase() &&
      c.location.toLowerCase() === location.toLowerCase()
    );

    if (!isDuplicate) {
      constraints.push({
        attribute,
        attributeType: inferAttributeType(attribute),
        location,
        locationType: inferLocationType(location),
        relationship,
        confidence: 0.87,
        originalPhrase: match[0]
      });

      // Remove from cleaned prompt
      cleanedPrompt = cleanedPrompt.replace(match[0], '').trim();
    }
  }

  // Clean up multiple spaces
  cleanedPrompt = cleanedPrompt.replace(/\s+/g, ' ').trim();

  return {
    spatialConstraints: constraints,
    hasSpatial: constraints.length > 0,
    cleanedPrompt
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Infer the type of attribute
 */
function inferAttributeType(attribute: string): string {
  const attr = attribute.toLowerCase();

  // Pattern indicators
  if (/stripe|stripes|plaid|floral|dot|dots|check|geometric|abstract|print/.test(attr)) {
    return 'pattern';
  }

  // Detail indicators
  if (/button|buttons|zipper|zip|pocket|pockets|stitch|stitching|embroidery|lace|ruffle|frill/.test(attr)) {
    return 'detail';
  }

  // Color indicators
  if (/color|colored|tone|shade|hue|black|white|red|blue|green|yellow/.test(attr)) {
    return 'color';
  }

  // Texture indicators
  if (/texture|textured|smooth|rough|soft|fuzzy|shiny|matte/.test(attr)) {
    return 'texture';
  }

  // Material indicators
  if (/leather|cotton|silk|wool|denim|suede|velvet/.test(attr)) {
    return 'material';
  }

  return 'attribute';
}

/**
 * Infer the type of location
 */
function inferLocationType(location: string): string {
  const loc = location.toLowerCase();

  // Specific garment parts
  if (GARMENT_PARTS.sleeves.includes(loc)) return 'sleeves';
  if (GARMENT_PARTS.collar.includes(loc)) return 'collar';
  if (GARMENT_PARTS.shoulders.includes(loc)) return 'shoulders';
  if (GARMENT_PARTS.chest.includes(loc)) return 'chest';
  if (GARMENT_PARTS.back.includes(loc)) return 'back';
  if (GARMENT_PARTS.front.includes(loc)) return 'front';
  if (GARMENT_PARTS.waist.includes(loc)) return 'waist';
  if (GARMENT_PARTS.hem.includes(loc)) return 'hem';
  if (GARMENT_PARTS.legs.includes(loc)) return 'legs';
  if (GARMENT_PARTS.pockets.includes(loc)) return 'pockets';
  if (GARMENT_PARTS.sides.includes(loc)) return 'sides';
  if (GARMENT_PARTS.seams.includes(loc)) return 'seams';
  if (GARMENT_PARTS.trim.includes(loc)) return 'trim';
  if (GARMENT_PARTS.panel.includes(loc)) return 'panel';

  return 'general';
}

/**
 * Check if attribute is valid for spatial relationships
 */
function isValidAttributeForSpatial(attribute: string): boolean {
  const attr = attribute.toLowerCase();

  // Skip common adjectives that aren't spatially relevant
  const skipWords = ['the', 'a', 'an', 'with', 'and', 'or', 'but', 'very', 'quite', 'more', 'less'];
  if (skipWords.includes(attr)) return false;

  // Check minimum length
  if (attr.length < 3) return false;

  return true;
}

// ─── Conversion Functions ─────────────────────────────────────────────────────

/**
 * Convert spatial constraints to search filter terms
 */
export function spatialToFilterTerms(constraints: SpatialConstraint[]): string[] {
  return constraints
    .filter(c => c.confidence >= 0.8)
    .map(c => {
      // Build combined filter term
      return `${c.attribute}-${c.relationship}-${c.location}`;
    });
}

/**
 * Group spatial constraints by location
 */
export function groupSpatialByLocation(constraints: SpatialConstraint[]): Record<string, SpatialConstraint[]> {
  const grouped: Record<string, SpatialConstraint[]> = {};

  for (const constraint of constraints) {
    if (!grouped[constraint.location]) {
      grouped[constraint.location] = [];
    }
    grouped[constraint.location].push(constraint);
  }

  return grouped;
}

/**
 * Get natural language summary of spatial constraints
 */
export function summarizeSpatial(constraints: SpatialConstraint[]): string {
  if (constraints.length === 0) return '';

  const grouped = groupSpatialByLocation(constraints);
  const parts: string[] = [];

  for (const [location, items] of Object.entries(grouped)) {
    if (items.length === 1) {
      const item = items[0];
      parts.push(`${item.attribute} ${item.relationship} ${location}`);
    } else {
      const attributes = items.map(i => i.attribute).join(' and ');
      parts.push(`${attributes} on ${location}`);
    }
  }

  return parts.join(', ');
}

/**
 * Convert spatial constraints to OpenSearch query clauses
 */
export function spatialToQueryClauses(constraints: SpatialConstraint[]): any[] {
  return constraints
    .filter(c => c.confidence >= 0.7)
    .map(c => {
      return {
        bool: {
          should: [
            // Match on exact phrase in description
            {
              match_phrase: {
                description: {
                  query: `${c.attribute} ${c.relationship} ${c.location}`,
                  boost: 2.0
                }
              }
            },
            // Match on attributes field
            {
              bool: {
                must: [
                  { match: { attributes: c.attribute } },
                  { match: { attributes: c.location } }
                ],
                boost: 1.5
              }
            },
            // Match on individual fields
            {
              bool: {
                must: [
                  { match: { [c.attributeType]: c.attribute } }
                ],
                boost: 1.0
              }
            }
          ],
          minimum_should_match: 1
        }
      };
    });
}

/**
 * Example usage and tests
 */
export function testSpatialParsing() {
  const testCases = [
    "I want stripes on the sleeves",
    "Find a dress with embroidery at the collar",
    "Looking for a jacket with pockets on the chest",
    "Show me shirts with buttons down the front",
    "I need a coat with pattern on sleeves",
    "Casual pants with zipper at the side",
    "A dress with floral print across the hem",
    "Jacket with leather patches on the shoulders"
  ];

  console.log('=== Spatial Relationship Handler Tests ===\n');
  for (const test of testCases) {
    const result = parseSpatialRelationships(test);
    console.log(`Input: "${test}"`);
    console.log(`Spatial constraints found: ${result.spatialConstraints.length}`);
    result.spatialConstraints.forEach(c => {
      console.log(`  - ${c.attribute} (${c.attributeType}) ${c.relationship} ${c.location} (confidence: ${c.confidence})`);
    });
    console.log(`Cleaned: "${result.cleanedPrompt}"`);
    console.log(`Summary: ${summarizeSpatial(result.spatialConstraints)}\n`);
  }
}
