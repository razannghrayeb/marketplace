import { CompositeQuery, AttributeFilter } from './compositeQueryBuilder';

// ============================================================================
// Types for OpenSearch and SQL query generation
// ============================================================================

export interface OpenSearchQuery {
  query: {
    bool: {
      must: any[];
      should?: any[];
      filter: any[];
      must_not?: any[];
    };
  };
  size?: number;
  _source?: string[];
}

export interface SQLFilter {
  column: string;
  operator: 'eq' | 'in' | 'like' | 'between' | 'not_in';
  value: string | number | string[] | number[];
}

export interface SearchQueryBundle {
  opensearch: OpenSearchQuery;
  sqlFilters: SQLFilter[];
  hybridScore: {
    vectorWeight: number;
    filterWeight: number;
    priceWeight: number;
  };
}

// ============================================================================
// Query Mapper - Convert composite queries to search engine queries
// ============================================================================

export class QueryMapper {
  private attributeColumnMap: Record<string, string>;
  private fuzzyThreshold: number;

  constructor() {
    this.attributeColumnMap = {
      color: 'color',
      material: 'description',
      pattern: 'description',
      style: 'description',
      category: 'category',
      brand: 'brand',
      price: 'price_cents',
      gender: 'color',
    };

    this.fuzzyThreshold = 0.7; // Similarity threshold for fuzzy matching
  }

  // -------------------------------------------------------------------------
  // Main Entry: Convert composite query to search bundle
  // -------------------------------------------------------------------------
  mapQuery(
    compositeQuery: CompositeQuery,
    options: {
      maxResults?: number;
      /** kNN neighbor count (defaults to a higher recall than maxResults) */
      vectorK?: number;
      vectorWeight?: number;
      filterWeight?: number;
      priceWeight?: number;
      /** Treat parsed constraints as hard filters (multi-image strict prompt mode). */
      strictConstraints?: boolean;
    } = {}
  ): SearchQueryBundle {
    const {
      maxResults = 100,
      vectorK,
      vectorWeight = 0.7,
      filterWeight = 0.2,
      priceWeight = 0.1,
      strictConstraints = false,
    } = options;

    // Build OpenSearch query
    const opensearch = this.buildOpenSearchQuery(
      compositeQuery,
      maxResults,
      vectorK,
      strictConstraints,
    );

    // Build SQL filters for additional filtering/hydration
    const sqlFilters = this.buildSQLFilters(compositeQuery);

    return {
      opensearch,
      sqlFilters,
      hybridScore: {
        vectorWeight,
        filterWeight,
        priceWeight,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Build OpenSearch query with kNN + filters
  // -------------------------------------------------------------------------
  private buildOpenSearchQuery(
    query: CompositeQuery,
    maxResults: number,
    vectorK?: number,
    strictConstraints = false,
  ): OpenSearchQuery {
    const must: any[] = [];
    const filter: any[] = [];
    const must_not: any[] = [];
    const should: any[] = [];

    // Attribute filters: never put exact/fuzzy in bool.filter with kNN — the ANN space is
    // then intersected with hard term/match filters and often becomes empty (log proof:
    // hitCount 0 with valid 512-d unit vector). Exclusions stay must_not; lexical hints boost via should.
    for (const attrFilter of query.filters) {
      const clause = this.buildFilterClause(attrFilter);
      if (clause) {
        if (attrFilter.operator === 'exclude') {
          must_not.push(clause);
        } else if (
          attrFilter.operator === 'fuzzy' ||
          attrFilter.operator === 'exact'
        ) {
          should.push(clause);
        } else if (attrFilter.operator === 'range') {
          const rangeShould = this.buildAttributeRangeShould(attrFilter);
          if (rangeShould) should.push(rangeShould);
        } else {
          filter.push(clause);
        }
      }
    }

    // Category / brand / gender from the model are hints — hard filters here often
    // produced zero hits (wrong first-pass labels, singular vs plural, etc.) while the
    // explanation text still looked correct. Prefer soft boosts so kNN recall stays intact.
    if (query.constraints.category) {
      const c = query.constraints.category.toLowerCase();
      if (strictConstraints) {
        filter.push({
          bool: {
            should: [
              { term: { category: c } },
              { term: { category_canonical: c } },
              { match: { category: { query: c, operator: 'and' } } },
            ],
            minimum_should_match: 1,
          },
        });
      } else {
        should.push(
          { term: { category: { value: c, boost: 2.5 } } },
          { match: { "category.search": { query: c, boost: 1.2 } } },
        );
      }
    }

    if (query.constraints.brands && query.constraints.brands.length > 0) {
      const brands = query.constraints.brands.map((b) => b.toLowerCase());
      if (strictConstraints) {
        filter.push({ terms: { brand: brands } });
      } else {
        for (const b of brands) {
          should.push({
            bool: {
              should: [
                { term: { brand: { value: b, boost: 2.0 } } },
                { match: { "brand.search": { query: b, boost: 1.0 } } },
              ],
              minimum_should_match: 1,
            },
          });
        }
      }
    }

    if (query.constraints.gender) {
      const g = query.constraints.gender.toLowerCase();
      if (strictConstraints) {
        filter.push({
          bool: {
            should: [
              { term: { attr_gender: g } },
              { term: { audience_gender: g } },
            ],
            minimum_should_match: 1,
          },
        });
      } else {
        should.push(
          { term: { attr_gender: { value: g, boost: 2.0 } } },
          { term: { audience_gender: { value: g, boost: 1.5 } } },
        );
      }
    }

    if (query.constraints.price) {
      const pr = query.constraints.price;
      if (pr.min !== undefined || pr.max !== undefined) {
        const range: Record<string, number> = strictConstraints ? {} : { boost: 2.0 };
        if (pr.min !== undefined) range.gte = pr.min;
        if (pr.max !== undefined) range.lte = pr.max;
        if (strictConstraints) filter.push({ range: { price_usd: range } });
        else should.push({ range: { price_usd: range } });
      }
    }

    // mustHave must NOT live in bool.must: that required every keyword to match at once
    // (AND), which routinely returned zero documents despite good kNN + explanation.
    for (const term of query.mustHave) {
      const t = String(term).trim();
      if (!t) continue;
      should.push({
        multi_match: {
          query: t,
          fields: ["title^2", "description", "category", "brand"],
          fuzziness: "AUTO",
          boost: 1.0,
        },
      });
    }

    for (const term of query.mustNotHave) {
      must_not.push({
        multi_match: {
          query: term,
          fields: ['title', 'category', 'brand'],
        },
      });
    }

    for (const sp of query.spatialRequirements || []) {
      const q = [sp.attribute, sp.location, sp.relationship]
        .filter((x) => x != null && String(x).trim() !== "")
        .join(" ")
        .trim();
      if (!q) continue;
      should.push({
        multi_match: {
          query: q,
          fields: ["title^1.2", "description"],
          boost: 0.45,
        },
      });
    }

    // Match kNN shape used by MultiVectorSearchEngine / image similarity: knn lives under
    // bool.must. A top-level `knn` sibling to `query` is not used elsewhere and can yield
    // no vector retrieval (empty results while filters/text clauses also match nothing).
    const embeddingField =
      String(process.env.SEARCH_IMAGE_KNN_FIELD ?? 'embedding').trim() || 'embedding';
    const k =
      vectorK ??
      Math.min(Math.max(maxResults * 4, 80), 320);
    const knnMust = {
      knn: {
        [embeddingField]: {
          vector: query.embeddings.global,
          k,
        },
      },
    };
    const mustClauses = [knnMust, ...must];

    filter.push({ term: { is_hidden: false } });

    return {
      size: maxResults,
      query: {
        bool: {
          must: mustClauses,
          should: should.length > 0 ? should : undefined,
          filter,
          must_not: must_not.length > 0 ? must_not : undefined,
        },
      },
      // Fields required by computeHitRelevance (same as text / image kNN ranking)
      _source: [
        'product_id',
        'title',
        'brand',
        'description',
        'price_usd',
        'image_cdn',
        'category',
        'category_canonical',
        'product_types',
        'attr_color',
        'attr_colors',
        'attr_colors_text',
        'attr_colors_image',
        'color_palette_canonical',
        'color_primary_canonical',
        'color_secondary_canonical',
        'color_accent_canonical',
        'color_confidence_text',
        'color_confidence_image',
        'audience_gender',
        'attr_gender',
        'age_group',
        'norm_confidence',
        'type_confidence',
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Build filter clause for a single attribute
  // -------------------------------------------------------------------------
  private buildFilterClause(filter: AttributeFilter): any {
    const field = this.getOpenSearchField(filter.attribute);

    switch (filter.operator) {
      case 'exact':
        return filter.values.length === 1
          ? { term: { [field]: filter.values[0] } }
          : { terms: { [field]: filter.values } };

      case 'fuzzy':
        return filter.values.length === 1
          ? {
              match: {
                [field]: {
                  query: filter.values[0],
                  fuzziness: 'AUTO',
                },
              },
            }
          : {
              bool: {
                should: filter.values.map(val => ({
                  match: { [field]: { query: val, fuzziness: 'AUTO' } },
                })),
                minimum_should_match: 1,
              },
            };

      case 'range':
        // Assume values are [min, max]
        const rangeFilter: any = { range: { [field]: {} } };
        if (filter.values[0]) rangeFilter.range[field].gte = filter.values[0];
        if (filter.values[1]) rangeFilter.range[field].lte = filter.values[1];
        return rangeFilter;

      case 'exclude':
        return filter.values.length === 1
          ? { term: { [field]: filter.values[0] } }
          : { terms: { [field]: filter.values } };

      default:
        return null;
    }
  }

  /** Range in bool.should so kNN is not annihilated by bad LLM numeric bounds. */
  private buildAttributeRangeShould(attrFilter: AttributeFilter): any | null {
    const field = this.getOpenSearchField(attrFilter.attribute);
    const r: Record<string, number> = { boost: 1.25 };
    const v0 = attrFilter.values[0];
    const v1 = attrFilter.values[1];
    if (v0 !== undefined && v0 !== null && String(v0).trim() !== '') {
      const n = Number(v0);
      if (Number.isFinite(n)) r.gte = n;
    }
    if (v1 !== undefined && v1 !== null && String(v1).trim() !== '') {
      const n = Number(v1);
      if (Number.isFinite(n)) r.lte = n;
    }
    if (!('gte' in r) && !('lte' in r)) return null;
    return { range: { [field]: r } };
  }

  // -------------------------------------------------------------------------
  // Map attribute to OpenSearch field name
  // -------------------------------------------------------------------------
  private getOpenSearchField(attribute: string): string {
    const fieldMap: Record<string, string> = {
      color: 'attr_color',
      material: 'attr_material',
      pattern: 'attr_pattern',
      style: 'attr_style',
      fit: 'attr_fit',
      gender: 'attr_gender',
    };

    return fieldMap[attribute] || attribute;
  }

  // -------------------------------------------------------------------------
  // Build SQL filters for PostgreSQL hydration
  // -------------------------------------------------------------------------
  private buildSQLFilters(query: CompositeQuery): SQLFilter[] {
    const filters: SQLFilter[] = [];

    // Add attribute filters
    for (const attrFilter of query.filters) {
      const column = this.attributeColumnMap[attrFilter.attribute];
      if (!column) continue;

      switch (attrFilter.operator) {
        case 'exact':
          filters.push({
            column,
            operator: attrFilter.values.length === 1 ? 'eq' : 'in',
            value: attrFilter.values.length === 1 ? attrFilter.values[0] : attrFilter.values,
          });
          break;

        case 'fuzzy':
          // Use ILIKE for fuzzy in SQL
          for (const val of attrFilter.values) {
            filters.push({
              column,
              operator: 'like',
              value: `%${val}%`,
            });
          }
          break;

        case 'range':
          filters.push({
            column,
            operator: 'between',
            value: attrFilter.values,
          });
          break;

        case 'exclude':
          filters.push({
            column,
            operator: 'not_in',
            value: attrFilter.values,
          });
          break;
      }
    }

    // Add constraint filters
    if (query.constraints.category) {
      filters.push({
        column: 'category',
        operator: 'eq',
        value: query.constraints.category,
      });
    }

    if (query.constraints.brands && query.constraints.brands.length > 0) {
      filters.push({
        column: 'brand',
        operator: 'in',
        value: query.constraints.brands,
      });
    }

    if (query.constraints.price) {
      const values: number[] = [];
      if (query.constraints.price.min !== undefined) values.push(query.constraints.price.min * 100);
      if (query.constraints.price.max !== undefined) values.push(query.constraints.price.max * 100);

      if (values.length > 0) {
        filters.push({
          column: 'price_cents',
          operator: 'between',
          value: values,
        });
      }
    }

    return filters;
  }

  // -------------------------------------------------------------------------
  // Build SQL WHERE clause from filters
  // -------------------------------------------------------------------------
  buildSQLWhereClause(filters: SQLFilter[]): { sql: string; params: any[] } {
    if (filters.length === 0) {
      return { sql: '', params: [] };
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const filter of filters) {
      switch (filter.operator) {
        case 'eq':
          conditions.push(`${filter.column} = $${paramIndex}`);
          params.push(filter.value);
          paramIndex++;
          break;

        case 'in':
          conditions.push(`${filter.column} = ANY($${paramIndex})`);
          params.push(filter.value);
          paramIndex++;
          break;

        case 'like':
          conditions.push(`${filter.column} ILIKE $${paramIndex}`);
          params.push(filter.value);
          paramIndex++;
          break;

        case 'between':
          const values = filter.value as number[];
          if (values.length === 2) {
            conditions.push(`${filter.column} BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
            params.push(values[0], values[1]);
            paramIndex += 2;
          } else if (values.length === 1) {
            conditions.push(`${filter.column} >= $${paramIndex}`);
            params.push(values[0]);
            paramIndex++;
          }
          break;

        case 'not_in':
          conditions.push(`${filter.column} != ALL($${paramIndex})`);
          params.push(filter.value);
          paramIndex++;
          break;
      }
    }

    return {
      sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createQueryMapper(): QueryMapper {
  return new QueryMapper();
}
