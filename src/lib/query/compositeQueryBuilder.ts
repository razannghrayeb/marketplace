import { ParsedIntent, ImageIntent, SearchConstraints } from '../prompt/gemeni';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CompositeEmbedding {
  global: number[];
  perAttribute: Record<string, number[]>;
  metadata: {
    dimensions: number;
    normalized: boolean;
    contributingImages: number[];
  };
}

export interface AttributeFilter {
  attribute: string;
  values: string[];
  operator: 'exact' | 'fuzzy' | 'range' | 'exclude';
  weight?: number;
  source?: 'extracted' | 'inferred' | 'user';
}

export interface PriceConstraint {
  min?: number;
  max?: number;
  currency?: string;
  source: 'explicit' | 'inferred';
}

export interface CompositeQuery {
  embeddings: CompositeEmbedding;
  filters: AttributeFilter[];
  constraints: {
    price?: PriceConstraint;
    category?: string;
    brands?: string[];
    size?: string;
    gender?: string;
    condition?: string;
  };
  mustHave: string[];
  mustNotHave: string[];
  searchStrategy: string;
  confidence: number;
  explanation: string;
}

export interface EmbeddingWeightConfig {
  globalBlendFactor: number; // α in formula: (1-α)E_global + α·Σ(β_A·E_A)
  attributeBoosts: Record<string, number>; // β_A for each attribute
  normalizeWeights: boolean;
  attributePriority: string[]; // Order of importance
}

// ============================================================================
// Composite Query Builder - Merge embeddings with intent weights
// ============================================================================

export class CompositeQueryBuilder {
  private config: EmbeddingWeightConfig;

  constructor(config?: Partial<EmbeddingWeightConfig>) {
    this.config = {
      globalBlendFactor: 0.6, // Favor global over per-attribute by default
      attributeBoosts: {
        color: 1.2,
        texture: 1.1,
        material: 1.1,
        silhouette: 1.0,
        style: 0.9,
        pattern: 0.8,
        fit: 0.8,
      },
      normalizeWeights: true,
      attributePriority: ['color', 'material', 'texture', 'silhouette', 'style', 'pattern', 'fit'],
      ...config,
    };
  }

  // -------------------------------------------------------------------------
  // Main Entry: Build composite query from parsed intent + embeddings
  // -------------------------------------------------------------------------
  async buildQuery(
    intent: ParsedIntent,
    imageEmbeddings: number[][]
  ): Promise<CompositeQuery> {
    // Step 1: Merge embeddings with intent weights
    const embeddings = this.mergeEmbeddings(intent.imageIntents, imageEmbeddings);

    // Step 2: Extract and map attribute filters from NL
    const filters = this.extractAttributeFilters(intent);

    // Step 3: Parse and normalize constraints
    const constraints = this.parseConstraints(intent.constraints);

    // Step 4: Build explanation
    const explanation = this.buildExplanation(intent, embeddings);

    return {
      embeddings,
      filters,
      constraints,
      mustHave: intent.constraints.mustHave,
      mustNotHave: intent.constraints.mustNotHave,
      searchStrategy: intent.searchStrategy,
      confidence: intent.confidence,
      explanation,
    };
  }

  // -------------------------------------------------------------------------
  // Step 1: Merge embeddings with intent weights
  // Formula: E_global = Σ(w_i · e_i)
  //          E_attr = Σ(w_i,attr · e_i) for each attribute
  //          E_final = (1-α)·E_global + α·Σ(β_attr · E_attr)
  // -------------------------------------------------------------------------
  private mergeEmbeddings(
    imageIntents: ImageIntent[],
    embeddings: number[][]
  ): CompositeEmbedding {
    if (embeddings.length === 0) {
      throw new Error('No embeddings provided');
    }

    const dimensions = embeddings[0].length;

    // Gemini occasionally returns no image rows; fall back to equal blend of all uploads.
    let effectiveIntents = imageIntents;
    if (!effectiveIntents || effectiveIntents.length === 0) {
      const w = 1 / embeddings.length;
      effectiveIntents = embeddings.map((_, idx) => ({
        imageIndex: idx,
        primaryAttributes: ['color', 'style', 'silhouette', 'texture', 'material', 'pattern'],
        weight: w,
        reasoning: 'Fallback: equal weight over all images',
      }));
    }

    const contributingImages = effectiveIntents.map(intent => intent.imageIndex);

    // Initialize global embedding
    const globalEmbedding = new Array(dimensions).fill(0);

    // Initialize per-attribute embeddings
    const perAttributeEmbeddings: Record<string, number[]> = {};
    const attributeCounts: Record<string, number> = {};

    // Compute weighted global embedding: E_global = Σ(w_i · e_i)
    for (const intent of effectiveIntents) {
      const embedding = embeddings[intent.imageIndex];
      if (!embedding) {
        console.warn(`Missing embedding for image ${intent.imageIndex}`);
        continue;
      }

      // Add to global embedding
      for (let i = 0; i < dimensions; i++) {
        globalEmbedding[i] += intent.weight * embedding[i];
      }

      // Add to per-attribute embeddings
      for (const attr of intent.primaryAttributes) {
        if (!perAttributeEmbeddings[attr]) {
          perAttributeEmbeddings[attr] = new Array(dimensions).fill(0);
          attributeCounts[attr] = 0;
        }

        const attrWeight = this.getAttributeWeight(attr, intent);
        attributeCounts[attr] += attrWeight;

        for (let i = 0; i < dimensions; i++) {
          perAttributeEmbeddings[attr][i] += attrWeight * embedding[i];
        }
      }
    }

    // Normalize per-attribute embeddings
    for (const [attr, embedding] of Object.entries(perAttributeEmbeddings)) {
      const count = attributeCounts[attr];
      if (count > 0) {
        for (let i = 0; i < dimensions; i++) {
          embedding[i] /= count;
        }
      }
    }

    // Apply attribute boosts and blend with global
    // E_final = (1-α)·E_global + α·Σ(β_attr · E_attr)
    const finalEmbedding = new Array(dimensions).fill(0);
    const alpha = this.config.globalBlendFactor;

    // Add global component
    for (let i = 0; i < dimensions; i++) {
      finalEmbedding[i] = (1 - alpha) * globalEmbedding[i];
    }

    // Add weighted per-attribute components
    const totalBoost = Object.keys(perAttributeEmbeddings).reduce(
      (sum, attr) => sum + (this.config.attributeBoosts[attr] || 1.0),
      0
    );

    for (const [attr, embedding] of Object.entries(perAttributeEmbeddings)) {
      const boost = this.config.attributeBoosts[attr] || 1.0;
      const normalizedBoost = totalBoost > 0 ? boost / totalBoost : 0;

      for (let i = 0; i < dimensions; i++) {
        finalEmbedding[i] += alpha * normalizedBoost * embedding[i];
      }
    }

    // Normalize final embedding
    const finalNormalized = this.config.normalizeWeights
      ? this.normalizeVector(finalEmbedding)
      : finalEmbedding;

    return {
      global: finalNormalized,
      perAttribute: Object.fromEntries(
        Object.entries(perAttributeEmbeddings).map(([attr, emb]) => [
          attr,
          this.normalizeVector(emb),
        ])
      ),
      metadata: {
        dimensions,
        normalized: this.config.normalizeWeights,
        contributingImages,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Extract and map attribute filters from natural language
  // -------------------------------------------------------------------------
  private extractAttributeFilters(intent: ParsedIntent): AttributeFilter[] {
    const filters: AttributeFilter[] = [];

    // Extract from image intents
    for (const imageIntent of intent.imageIntents) {
      if (!imageIntent.extractedValues) continue;

      for (const [attribute, value] of Object.entries(imageIntent.extractedValues)) {
        const filter = this.createAttributeFilter(
          attribute,
          value,
          imageIntent.weight
        );
        if (filter) filters.push(filter);
      }
    }

    // Add must-have constraints as filters
    for (const mustHave of intent.constraints.mustHave) {
      const filter = this.inferAttributeFilter(mustHave, 'exact');
      if (filter) filters.push(filter);
    }

    // Add must-not constraints as exclusions
    for (const mustNotHave of intent.constraints.mustNotHave) {
      const filter = this.inferAttributeFilter(mustNotHave, 'exclude');
      if (filter) filters.push(filter);
    }

    // Deduplicate and merge similar filters
    return this.deduplicateFilters(filters);
  }

  private createAttributeFilter(
    attribute: string,
    value: string | string[] | unknown,
    weight: number
  ): AttributeFilter | null {
    const values = this.flattenExtractedValues(value).map((v) =>
      this.normalizeFilterString(v),
    ).filter((v) => v.length > 0);

    const canonicalAttr = this.canonicalizeAttribute(attribute);
    if (!canonicalAttr || values.length === 0) return null;

    const operator = this.determineOperator(canonicalAttr, values);

    return {
      attribute: canonicalAttr,
      values,
      operator,
      weight,
      source: 'extracted',
    };
  }

  /** Gemini may return numbers, booleans, objects, or nested arrays in extractedValues. */
  private flattenExtractedValues(value: unknown): string[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.flatMap((v) => this.flattenExtractedValues(v));
    }
    if (typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (typeof o.label === 'string') return [o.label];
      if (typeof o.name === 'string') return [o.name];
      if (typeof o.value === 'string' || typeof o.value === 'number') {
        return [String(o.value)];
      }
      if (Array.isArray(o.values)) return this.flattenExtractedValues(o.values);
      return [];
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }
    return [];
  }

  private normalizeFilterString(value: string): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private inferAttributeFilter(
    keyword: string,
    operator: 'exact' | 'exclude'
  ): AttributeFilter | null {
    // Try to infer attribute type from keyword
    const attributeMap: Record<string, string[]> = {
      color: ['black', 'white', 'red', 'blue', 'green', 'brown', 'beige', 'navy', 'burgundy', 'wine'],
      material: ['leather', 'cotton', 'silk', 'denim', 'wool', 'linen', 'suede', 'velvet'],
      pattern: ['solid', 'striped', 'plaid', 'floral', 'geometric', 'checkered'],
      fit: ['fitted', 'oversized', 'cropped', 'slim', 'loose', 'regular'],
      style: ['casual', 'formal', 'vintage', 'modern', 'minimalist', 'streetwear', 'edgy'],
    };

    for (const [attr, keywords] of Object.entries(attributeMap)) {
      if (keywords.some(kw => keyword.toLowerCase().includes(kw))) {
        return {
          attribute: attr,
          values: [keyword],
          operator,
          weight: 1.0,
          source: 'inferred',
        };
      }
    }

    return null;
  }

  private canonicalizeAttribute(attr: string): string | null {
    const key = String(attr ?? '')
      .toLowerCase()
      .trim();
    if (!key) return null;

    const mapping: Record<string, string> = {
      colour: 'color',
      colors: 'color',
      colortone: 'color',
      fabric: 'material',
      texture: 'material',
      print: 'pattern',
      shape: 'silhouette',
      cut: 'silhouette',
      vibe: 'style',
      aesthetic: 'style',
    };

    return mapping[key] || key;
  }

  private determineOperator(
    attribute: string,
    values: string[]
  ): 'exact' | 'fuzzy' | 'range' | 'exclude' {
    // LLM-extracted tokens rarely match catalog keywords exactly; prefer soft match.
    if (
      ['color', 'material', 'texture', 'pattern', 'style', 'fit', 'silhouette'].includes(
        attribute,
      )
    ) {
      return 'fuzzy';
    }

    if (attribute === 'size' || attribute === 'length') {
      return 'range';
    }

    return 'exact';
  }

  private deduplicateFilters(filters: AttributeFilter[]): AttributeFilter[] {
    const grouped = new Map<string, AttributeFilter[]>();

    // Group by attribute
    for (const filter of filters) {
      const key = filter.attribute;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(filter);
    }

    // Merge filters for same attribute
    const deduplicated: AttributeFilter[] = [];
    for (const [attr, attrFilters] of grouped) {
      if (attrFilters.length === 1) {
        deduplicated.push(attrFilters[0]);
        continue;
      }

      // Merge multiple filters for same attribute
      const allValues = new Set<string>();
      let totalWeight = 0;
      let operator = attrFilters[0].operator;

      for (const filter of attrFilters) {
        filter.values.forEach(v => allValues.add(v));
        totalWeight += filter.weight || 0;
        // If any is exact, prefer exact
        if (filter.operator === 'exact') operator = 'exact';
      }

      deduplicated.push({
        attribute: attr,
        values: Array.from(allValues),
        operator,
        weight: totalWeight / attrFilters.length,
        source: 'extracted',
      });
    }

    return deduplicated;
  }

  // -------------------------------------------------------------------------
  // Step 3: Parse and normalize constraints (price, category, brands)
  // -------------------------------------------------------------------------
  private parseConstraints(constraints: SearchConstraints): CompositeQuery['constraints'] {
    return {
      price: this.parsePriceConstraint(constraints),
      category: constraints.category,
      brands: constraints.brands || [],
      size: constraints.size,
      gender: constraints.gender,
      condition: undefined, // Could be extended
    };
  }

  private parsePriceConstraint(constraints: SearchConstraints): PriceConstraint | undefined {
    if (!constraints.priceMin && !constraints.priceMax) {
      return undefined;
    }

    return {
      min: constraints.priceMin,
      max: constraints.priceMax,
      currency: 'USD', // Default, could be inferred
      source: constraints.priceMin || constraints.priceMax ? 'explicit' : 'inferred',
    };
  }

  // -------------------------------------------------------------------------
  // Utility: Get attribute-specific weight for an intent
  // -------------------------------------------------------------------------
  private getAttributeWeight(attr: string, intent: ImageIntent): number {
    // If extractedValues has specific weight info, use it
    // Otherwise use the intent's overall weight
    return intent.weight;
  }

  // -------------------------------------------------------------------------
  // Utility: Normalize vector to unit length
  // -------------------------------------------------------------------------
  private normalizeVector(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vec;
    return vec.map(val => val / magnitude);
  }

  // -------------------------------------------------------------------------
  // Utility: Build human-readable explanation
  // -------------------------------------------------------------------------
  private buildExplanation(intent: ParsedIntent, embeddings: CompositeEmbedding): string {
    const parts: string[] = [];

    // Add image contribution summary
    for (const imageIntent of intent.imageIntents) {
      const attrs = imageIntent.primaryAttributes.join(', ');
      const pct = Math.round(imageIntent.weight * 100);
      parts.push(`Image ${imageIntent.imageIndex}: ${attrs} (${pct}% weight)`);
    }

    // Add per-attribute info
    const attrList = Object.keys(embeddings.perAttribute);
    if (attrList.length > 0) {
      parts.push(`Attributes optimized: ${attrList.join(', ')}`);
    }

    return parts.join(' | ');
  }
}

// ============================================================================
// Factory function for easy instantiation
// ============================================================================

export function createCompositeQueryBuilder(
  config?: Partial<EmbeddingWeightConfig>
): CompositeQueryBuilder {
  return new CompositeQueryBuilder(config);
}
