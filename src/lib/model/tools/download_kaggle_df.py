#!/usr/bin/env python3
"""
Download a file from a Kaggle dataset using kagglehub and save as CSV.

Usage:
  python tools/download_kaggle_df.py --dataset thusharanair/deepfashion2-original-with-dataframes \
      --file annotations.csv --out data/raw

Note: Ensure `kagglehub[pandas-datasets]` is installed and Kaggle credentials are configured.
"""
import argparse
from pathlib import Path
from kagglehub import KaggleDatasetAdapter, load_dataset


def main():
    parser = argparse.ArgumentParser(description='Download a file from a Kaggle dataset via kagglehub')
    parser.add_argument('--dataset', required=True, help='Kaggle dataset identifier, e.g. owner/dataset-name')
    parser.add_argument('--file', required=True, help='Path to file inside dataset (e.g. annotations.csv)')
    parser.add_argument('--out', default='data/raw', help='Output directory')
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading dataset {args.dataset} file {args.file}...")
    df = load_dataset(KaggleDatasetAdapter.PANDAS, args.dataset, args.file)

    out_path = out_dir / Path(args.file).name
    df.to_csv(out_path, index=False)
    print(f"Saved: {out_path}")
    print(df.head())


if __name__ == '__main__':
    main()
