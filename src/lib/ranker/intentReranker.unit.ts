/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { intentAwareRerank } from './intentReranker';

const makeIntent = (imageIntents: any[] = [], constraints: any = {}) => ({
  imageIntents,
  constraints,
  searchStrategy: 'test',
  confidence: 0.9,
});

describe('intentAwareRerank', () => {
  test('prefers candidates matching high-weight attribute from intent', () => {
    const intent = makeIntent([
      { imageIndex: 0, primaryAttributes: ['color'], weight: 2 },
    ]);

    const results = [
      {
        productId: 'a',
        score: 0.5,
        product: { priceUsd: 50, availability: 'in_stock' },
        scoreBreakdown: [ { attribute: 'color', similarity: 0.9 } ],
      },
      {
        productId: 'b',
        score: 0.8,
        product: { priceUsd: 50, availability: 'in_stock' },
        scoreBreakdown: [ { attribute: 'style', similarity: 0.95 } ],
      },
    ];

    const reranked = intentAwareRerank(results as any, intent as any, { vectorWeight: 0.6, attributeWeight: 0.3, priceWeight: 0.1 });
    expect(reranked[0].productId).toBe('a');
  });

  test('price proximity increases score when constraints provided', () => {
    const intent = makeIntent([], { priceMin: 40, priceMax: 60 });

    const results = [
      {
        productId: 'cheap',
        score: 0.7,
        product: { priceUsd: 50, availability: 'in_stock' },
        scoreBreakdown: [],
      },
      {
        productId: 'expensive',
        score: 0.9,
        product: { priceUsd: 200, availability: 'in_stock' },
        scoreBreakdown: [],
      },
    ];

    const reranked = intentAwareRerank(results as any, intent as any, { vectorWeight: 0.6, attributeWeight: 0.2, priceWeight: 0.2 });
    expect(reranked[0].productId).toBe('cheap');
  });
});
