import random
from collections import defaultdict
from typing import Iterator, List, Optional
from torch.utils.data import Sampler


class OutfitBatchSampler(Sampler[List[int]]):
    """Sampler that yields batches with multiple items per outfit.

    Args:
      dataset: dataset with attribute 'df' containing optional 'outfit_id' column
      outfits_per_batch: number of distinct outfits per batch
      items_per_outfit: number of items sampled from each outfit
      drop_last: whether to drop last incomplete batch
    """

    def __init__(self, dataset, outfits_per_batch: int = 8, items_per_outfit: int = 4, drop_last: bool = False):
        self.dataset = dataset
        self.outfits_per_batch = outfits_per_batch
        self.items_per_outfit = items_per_outfit
        self.batch_size = outfits_per_batch * items_per_outfit
        self.drop_last = drop_last

        # Build mapping outfit_id -> list(indices)
        self.outfit_map = defaultdict(list)
        for idx, row in dataset.df.iterrows():
            oid = row.get('outfit_id') if 'outfit_id' in dataset.df.columns else None
            if oid is None or (isinstance(oid, float) and str(oid) == 'nan'):
                # Treat missing as unique per index
                self.outfit_map[f'_unique_{idx}'].append(idx)
            else:
                self.outfit_map[int(oid)].append(idx)

        # Remove outfits with only one item if items_per_outfit > 1 (they can still be used but will be sampled with replacement)
        self.outfit_ids = list(self.outfit_map.keys())

    def __len__(self):
        total = len(self.dataset)
        if self.drop_last:
            return total // self.batch_size
        else:
            return (total + self.batch_size - 1) // self.batch_size

    def __iter__(self) -> Iterator[List[int]]:
        # Shuffle outfit ids each epoch
        outfit_ids = self.outfit_ids.copy()
        random.shuffle(outfit_ids)

        batch: List[int] = []
        i = 0
        while i < len(outfit_ids):
            selected = outfit_ids[i:i + self.outfits_per_batch]
            i += self.outfits_per_batch

            for oid in selected:
                indices = self.outfit_map[oid]
                if len(indices) >= self.items_per_outfit:
                    sampled = random.sample(indices, self.items_per_outfit)
                else:
                    # sample with replacement
                    sampled = [random.choice(indices) for _ in range(self.items_per_outfit)]
                batch.extend(sampled)

            if len(batch) == self.batch_size:
                yield batch
                batch = []

        if not self.drop_last and batch:
            # If leftover, pad with random indices
            remaining = self.batch_size - len(batch)
            all_indices = list(range(len(self.dataset)))
            batch.extend(random.choices(all_indices, k=remaining))
            yield batch
