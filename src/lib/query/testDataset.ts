/**
 * Test Dataset for Composite Query Evaluation
 * 
 * Contains curated multi-image search scenarios with ground truth labels.
 */

export interface TestQuery {
  id: string;
  description: string;
  images: string[]; // Paths to test images
  userPrompt: string;
  expectedIntent: {
    primaryAttributes: Record<number, string[]>; // imageIndex -> attributes
    constraints: {
      category?: string;
      priceRange?: [number, number];
      mustHave?: string[];
      mustNotHave?: string[];
    };
  };
  groundTruth: {
    relevantProducts: number[]; // Product IDs with relevance >= 2
    perfectMatches: number[]; // Product IDs with relevance = 3
    attributeMatches: Record<number, {
      color: number;
      material: number;
      silhouette: number;
      style: number;
    }>;
  };
}

/**
 * Test Dataset: Multi-Image Composite Queries
 */
export const testDataset: TestQuery[] = [
  {
    id: 'q001',
    description: 'Color from first image, texture from second',
    images: ['test_images/burgundy_silk_dress.jpg', 'test_images/distressed_leather_jacket.jpg'],
    userPrompt: 'I want the color of the first picture with the texture from the second',
    expectedIntent: {
      primaryAttributes: {
        0: ['color', 'colorTone'],
        1: ['texture', 'material'],
      },
      constraints: {
        mustHave: ['burgundy', 'leather', 'distressed'],
      },
    },
    groundTruth: {
      relevantProducts: [101, 102, 105, 110],
      perfectMatches: [101],
      attributeMatches: {
        101: { color: 0.95, material: 0.90, silhouette: 0.70, style: 0.80 },
        102: { color: 0.85, material: 0.85, silhouette: 0.60, style: 0.70 },
        105: { color: 0.90, material: 0.70, silhouette: 0.50, style: 0.65 },
        110: { color: 0.80, material: 0.80, silhouette: 0.55, style: 0.60 },
      },
    },
  },

  {
    id: 'q002',
    description: 'Style from first, fit from second',
    images: ['test_images/vintage_oversized_sweater.jpg', 'test_images/fitted_blazer.jpg'],
    userPrompt: 'Something like the first one but with the fit of the second',
    expectedIntent: {
      primaryAttributes: {
        0: ['style', 'pattern', 'color'],
        1: ['fit', 'silhouette'],
      },
      constraints: {
        category: 'top',
        mustHave: ['vintage', 'fitted'],
      },
    },
    groundTruth: {
      relevantProducts: [201, 202, 205],
      perfectMatches: [201],
      attributeMatches: {
        201: { color: 0.90, material: 0.75, silhouette: 0.95, style: 0.90 },
        202: { color: 0.85, material: 0.70, silhouette: 0.90, style: 0.85 },
        205: { color: 0.80, material: 0.65, silhouette: 0.85, style: 0.80 },
      },
    },
  },

  {
    id: 'q003',
    description: 'Mix three attributes from different images',
    images: [
      'test_images/navy_wool_coat.jpg',
      'test_images/structured_shoulders.jpg',
      'test_images/minimalist_buttons.jpg',
    ],
    userPrompt: 'Navy color from first, structured shoulders from second, minimal buttons like third',
    expectedIntent: {
      primaryAttributes: {
        0: ['color'],
        1: ['silhouette', 'details'],
        2: ['details', 'style'],
      },
      constraints: {
        category: 'coat',
        mustHave: ['navy', 'structured', 'minimal'],
      },
    },
    groundTruth: {
      relevantProducts: [301, 302, 305, 308],
      perfectMatches: [301, 302],
      attributeMatches: {
        301: { color: 0.95, material: 0.85, silhouette: 0.90, style: 0.88 },
        302: { color: 0.92, material: 0.80, silhouette: 0.92, style: 0.90 },
        305: { color: 0.90, material: 0.75, silhouette: 0.85, style: 0.82 },
        308: { color: 0.85, material: 0.70, silhouette: 0.80, style: 0.78 },
      },
    },
  },

  {
    id: 'q004',
    description: 'Price constraint with color preference',
    images: ['test_images/red_leather_bag.jpg'],
    userPrompt: 'I want a red leather bag like this but under $150',
    expectedIntent: {
      primaryAttributes: {
        0: ['color', 'material', 'style'],
      },
      constraints: {
        category: 'bag',
        priceRange: [0, 150],
        mustHave: ['red', 'leather'],
      },
    },
    groundTruth: {
      relevantProducts: [401, 402, 405],
      perfectMatches: [401],
      attributeMatches: {
        401: { color: 0.95, material: 0.95, silhouette: 0.85, style: 0.88 },
        402: { color: 0.90, material: 0.90, silhouette: 0.80, style: 0.85 },
        405: { color: 0.85, material: 0.85, silhouette: 0.75, style: 0.80 },
      },
    },
  },

  {
    id: 'q005',
    description: 'Negative constraint with attribute mix',
    images: ['test_images/casual_tshirt.jpg', 'test_images/premium_cotton.jpg'],
    userPrompt: 'Casual like first, premium cotton from second, but NOT oversized',
    expectedIntent: {
      primaryAttributes: {
        0: ['style', 'occasion'],
        1: ['material', 'texture'],
      },
      constraints: {
        category: 'shirt',
        mustHave: ['casual', 'premium', 'cotton'],
        mustNotHave: ['oversized'],
      },
    },
    groundTruth: {
      relevantProducts: [501, 502, 505, 508],
      perfectMatches: [501, 502],
      attributeMatches: {
        501: { color: 0.85, material: 0.95, silhouette: 0.90, style: 0.92 },
        502: { color: 0.80, material: 0.92, silhouette: 0.88, style: 0.90 },
        505: { color: 0.75, material: 0.88, silhouette: 0.85, style: 0.85 },
        508: { color: 0.70, material: 0.85, silhouette: 0.82, style: 0.82 },
      },
    },
  },

  {
    id: 'q006',
    description: 'Modifier: darker version',
    images: ['test_images/light_blue_jeans.jpg'],
    userPrompt: 'I want jeans like these but darker',
    expectedIntent: {
      primaryAttributes: {
        0: ['silhouette', 'fit', 'style'],
      },
      constraints: {
        category: 'jeans',
        mustHave: ['dark', 'darker'],
      },
    },
    groundTruth: {
      relevantProducts: [601, 602, 605],
      perfectMatches: [601],
      attributeMatches: {
        601: { color: 0.95, material: 0.90, silhouette: 0.92, style: 0.90 },
        602: { color: 0.90, material: 0.88, silhouette: 0.90, style: 0.88 },
        605: { color: 0.85, material: 0.85, silhouette: 0.88, style: 0.85 },
      },
    },
  },

  {
    id: 'q007',
    description: 'Brand preference with style mix',
    images: ['test_images/streetwear_hoodie.jpg', 'test_images/minimal_logo.jpg'],
    userPrompt: 'Streetwear vibe from first, minimal branding like second, Nike or Adidas only',
    expectedIntent: {
      primaryAttributes: {
        0: ['style'],
        1: ['details'],
      },
      constraints: {
        category: 'hoodie',
        mustHave: ['streetwear', 'minimal'],
      },
    },
    groundTruth: {
      relevantProducts: [701, 702, 705],
      perfectMatches: [701],
      attributeMatches: {
        701: { color: 0.85, material: 0.88, silhouette: 0.90, style: 0.95 },
        702: { color: 0.82, material: 0.85, silhouette: 0.88, style: 0.92 },
        705: { color: 0.80, material: 0.82, silhouette: 0.85, style: 0.90 },
      },
    },
  },

  {
    id: 'q008',
    description: 'Equal weight: both images equally important',
    images: ['test_images/floral_pattern.jpg', 'test_images/flowing_silhouette.jpg'],
    userPrompt: 'I want to combine the floral pattern and the flowing silhouette',
    expectedIntent: {
      primaryAttributes: {
        0: ['pattern', 'color'],
        1: ['silhouette', 'fit'],
      },
      constraints: {
        mustHave: ['floral', 'flowing'],
      },
    },
    groundTruth: {
      relevantProducts: [801, 802, 805, 808],
      perfectMatches: [801, 802],
      attributeMatches: {
        801: { color: 0.90, material: 0.80, silhouette: 0.95, style: 0.92 },
        802: { color: 0.88, material: 0.78, silhouette: 0.92, style: 0.90 },
        805: { color: 0.85, material: 0.75, silhouette: 0.88, style: 0.85 },
        808: { color: 0.82, material: 0.72, silhouette: 0.85, style: 0.82 },
      },
    },
  },
];

/**
 * Get test queries by category
 */
export function getTestQueriesByCategory(category: string): TestQuery[] {
  return testDataset.filter(
    q => q.expectedIntent.constraints.category === category
  );
}

/**
 * Get test queries with multiple images
 */
export function getMultiImageQueries(): TestQuery[] {
  return testDataset.filter(q => q.images.length > 1);
}

/**
 * Get test queries with price constraints
 */
export function getPriceConstrainedQueries(): TestQuery[] {
  return testDataset.filter(q => q.expectedIntent.constraints.priceRange !== undefined);
}

/**
 * Get test queries with negative constraints
 */
export function getNegativeConstraintQueries(): TestQuery[] {
  return testDataset.filter(
    q => q.expectedIntent.constraints.mustNotHave && q.expectedIntent.constraints.mustNotHave.length > 0
  );
}
