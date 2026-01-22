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
  knn?: {
    embedding: {
      vector: number[];
      k: number;
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
    // Map semantic attributes to database columns
    this.attributeColumnMap = {
      color: 'attributes->\'color\'',
      material: 'attributes->\'material\'',
      pattern: 'attributes->\'pattern\'',
      style: 'attributes->\'style\'',
      silhouette: 'attributes->\'silhouette\'',
      fit: 'attributes->\'fit\'',
      texture: 'attributes->\'texture\'',
      occasion: 'attributes->\'occasion\'',
      category: 'category',
      brand: 'brand',
      price: 'price',
      size: 'size',
      gender: 'gender',
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
      vectorWeight?: number;
      filterWeight?: number;
      priceWeight?: number;
    } = {}
  ): SearchQueryBundle {
    const {
      maxResults = 100,
      vectorWeight = 0.7,
      filterWeight = 0.2,
      priceWeight = 0.1,
    } = options;

    // Build OpenSearch query
    const opensearch = this.buildOpenSearchQuery(compositeQuery, maxResults);

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
    maxResults: number
  ): OpenSearchQuery {
    const must: any[] = [];
    const filter: any[] = [];
    const must_not: any[] = [];
    const should: any[] = [];

    // Add attribute filters
    for (const attrFilter of query.filters) {
      const clause = this.buildFilterClause(attrFilter);
      if (clause) {
        if (attrFilter.operator === 'exclude') {
          must_not.push(clause);
        } else if (attrFilter.operator === 'fuzzy') {
          should.push(clause);
        } else {
          filter.push(clause);
        }
      }
    }

    // Add constraint filters
    if (query.constraints.category) {
      filter.push({
        term: { category: query.constraints.category.toLowerCase() },
      });
    }

    if (query.constraints.brands && query.constraints.brands.length > 0) {
      filter.push({
        terms: { brand: query.constraints.brands.map(b => b.toLowerCase()) },
      });
    }

    if (query.constraints.size) {
      filter.push({
        term: { size: query.constraints.size.toLowerCase() },
      });
    }

    if (query.constraints.gender) {
      filter.push({
        term: { gender: query.constraints.gender.toLowerCase() },
      });
    }

    // Add price range filter
    if (query.constraints.price) {
      const priceFilter: any = { range: { price: {} } };
      if (query.constraints.price.min !== undefined) {
        priceFilter.range.price.gte = query.constraints.price.min;
      }
      if (query.constraints.price.max !== undefined) {
        priceFilter.range.price.lte = query.constraints.price.max;
      }
      filter.push(priceFilter);
    }

    // Add must-have terms as text match
    for (const term of query.mustHave) {
      must.push({
        multi_match: {
          query: term,
          fields: ['name', 'description', 'attributes.*'],
          fuzziness: 'AUTO',
        },
      });
    }

    // Add must-not-have terms as exclusions
    for (const term of query.mustNotHave) {
      must_not.push({
        multi_match: {
          query: term,
          fields: ['name', 'description', 'attributes.*'],
        },
      });
    }

    return {
      query: {
        bool: {
          must: must.length > 0 ? must : undefined!,
          should: should.length > 0 ? should : undefined,
          filter,
          must_not: must_not.length > 0 ? must_not : undefined,
        },
      },
      knn: {
        embedding: {
          vector: query.embeddings.global,
          k: maxResults,
        },
      },
      size: maxResults,
      _source: ['id', 'name', 'brand', 'price', 'image_url', 'category', 'attributes'],
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

  // -------------------------------------------------------------------------
  // Map attribute to OpenSearch field name
  // -------------------------------------------------------------------------
  private getOpenSearchField(attribute: string): string {
    const fieldMap: Record<string, string> = {
      color: 'attributes.color',
      material: 'attributes.material',
      pattern: 'attributes.pattern',
      style: 'attributes.style',
      silhouette: 'attributes.silhouette',
      fit: 'attributes.fit',
      texture: 'attributes.texture',
      occasion: 'attributes.occasion',
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
      if (query.constraints.price.min !== undefined) values.push(query.constraints.price.min);
      if (query.constraints.price.max !== undefined) values.push(query.constraints.price.max);

      if (values.length > 0) {
        filters.push({
          column: 'price',
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
